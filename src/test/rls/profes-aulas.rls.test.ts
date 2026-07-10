import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestAula,
  type TestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * RLS de `profes_aulas` (F5B-#34).
 *
 * Hasta este PR no existía un test RLS específico de la tabla — su
 * policía se ejercía indirectamente vía `messaging.rls.test.ts` (los
 * helpers `puede_participar_conversacion` la leen para validar "profe
 * del aula"). Este archivo cubre directamente:
 *
 *  1. Admin del centro: SELECT/INSERT/UPDATE/DELETE permitidos sobre
 *     `profes_aulas` de su centro.
 *  2. Admin de otro centro: SELECT cross-centro rechazado.
 *  3. Profe: ve solo sus propias asignaciones vía `profes_aulas_self_select`.
 *  4. Profe: no ve las asignaciones de otra profe.
 *  5. *Crítico — caso F5B-#34*: dos `tipo_personal_aula='coordinadora'`
 *     activas en la misma aula falla con SQLSTATE 23505 (índice único
 *     parcial `idx_un_coordinadora_activa_por_aula`).
 *  6. Tutor del centro: SELECT rechazado.
 *
 * Los inserts de coordinadora usan `serviceClient` (bypass RLS) porque
 * el goal del test es la integridad del índice, no la policy de INSERT.
 *
 * Gate: estos tests dependen de la migración `20260529193000` aplicada
 * en el proyecto remoto (Supabase Cloud). Mientras la migración no esté
 * aplicada, el INSERT con `tipo_personal_aula` rompe la suite con
 * "column does not exist". Activar el archivo entero con
 * `F5B34_MIGRATION_APPLIED=1` cuando el usuario aplique el SQL vía
 * SQL Editor (Nota F del Checkpoint B1+B2).
 */
const MIGRATION_APPLIED = process.env.F5B34_MIGRATION_APPLIED === '1'

describe.skipIf(!MIGRATION_APPLIED)(
  'RLS profes_aulas + índice coordinadora único (F5B-#34)',
  () => {
    let centroA: { id: string }
    let centroB: { id: string }
    let cursoA: { id: string }
    let aulaA1: TestAula
    let aulaA2: TestAula
    let adminA: TestUser
    let adminB: TestUser
    let profe1: TestUser
    let profe2: TestUser
    let tutor: TestUser
    let ninoA: { id: string }

    beforeAll(async () => {
      centroA = await createTestCentro('Centro Profes A')
      centroB = await createTestCentro('Centro Profes B')

      cursoA = await createTestCurso(centroA.id)
      aulaA1 = await createTestAula(centroA.id, cursoA.id, 'Aula PA1')
      aulaA2 = await createTestAula(centroA.id, cursoA.id, 'Aula PA2')

      adminA = await createTestUser({ nombre: 'Admin A' })
      adminB = await createTestUser({ nombre: 'Admin B' })
      profe1 = await createTestUser({ nombre: 'Profe 1' })
      profe2 = await createTestUser({ nombre: 'Profe 2' })
      tutor = await createTestUser({ nombre: 'Tutor' })

      await asignarRol(adminA.id, centroA.id, 'admin')
      await asignarRol(adminB.id, centroB.id, 'admin')
      await asignarRol(profe1.id, centroA.id, 'profe')
      await asignarRol(profe2.id, centroA.id, 'profe')
      await asignarRol(tutor.id, centroA.id, 'tutor_legal')

      // Niño + vínculo del tutor para que tenga presencia en el centro. Vía el factory
      // (único camino normal de creación de niños en tests; setea familia_id).
      const nino = await createTestNino(centroA.id, 'Niño RLS')
      ninoA = { id: nino.id }
      await crearVinculo(ninoA.id, tutor.id, 'tutor_legal_principal', {
        puede_ver_agenda: true,
      })

      // Asignamos profes vía serviceClient para tener semillas predecibles.
      // - profe1 coordinadora de aulaA1.
      // - profe2 profesora regular de aulaA2.
      const { error: e1 } = await serviceClient.from('profes_aulas').insert({
        profe_id: profe1.id,
        aula_id: aulaA1.id,
        curso_academico_id: aulaA1.curso_academico_id,
        fecha_inicio: '2026-09-01',
        tipo_personal_aula: 'coordinadora',
      })
      if (e1) throw new Error(`seed profe1: ${e1.message}`)
      const { error: e2 } = await serviceClient.from('profes_aulas').insert({
        profe_id: profe2.id,
        aula_id: aulaA2.id,
        curso_academico_id: aulaA2.curso_academico_id,
        fecha_inicio: '2026-09-01',
        tipo_personal_aula: 'profesora',
      })
      if (e2) throw new Error(`seed profe2: ${e2.message}`)
    }, 60_000)

    afterAll(async () => {
      await serviceClient.from('profes_aulas').delete().eq('profe_id', profe1.id)
      await serviceClient.from('profes_aulas').delete().eq('profe_id', profe2.id)
      await serviceClient.from('ninos').delete().eq('id', ninoA.id)
      await deleteTestCentro(centroA.id)
      await deleteTestCentro(centroB.id)
      await deleteTestUser(adminA.id)
      await deleteTestUser(adminB.id)
      await deleteTestUser(profe1.id)
      await deleteTestUser(profe2.id)
      await deleteTestUser(tutor.id)
    }, 60_000)

    it('admin del centro ve todas las asignaciones de profes_aulas', async () => {
      const c = await clientFor(adminA)
      const { data, error } = await c
        .from('profes_aulas')
        .select('id, profe_id, aula_id, tipo_personal_aula')
        .in('aula_id', [aulaA1.id, aulaA2.id])
      expect(error).toBeNull()
      expect(data ?? []).toHaveLength(2)
    })

    it('admin de OTRO centro NO ve profes_aulas cross-centro', async () => {
      const c = await clientFor(adminB)
      const { data, error } = await c
        .from('profes_aulas')
        .select('id')
        .in('aula_id', [aulaA1.id, aulaA2.id])
      expect(error).toBeNull()
      expect(data ?? []).toHaveLength(0)
    })

    it('profe ve sus propias asignaciones (self_select)', async () => {
      const c = await clientFor(profe1)
      const { data, error } = await c
        .from('profes_aulas')
        .select('id, aula_id, tipo_personal_aula')
        .eq('profe_id', profe1.id)
      expect(error).toBeNull()
      expect(data ?? []).toHaveLength(1)
      expect(data![0]!.tipo_personal_aula).toBe('coordinadora')
    })

    it('profe NO ve las asignaciones de otra profe (incluso del mismo centro)', async () => {
      const c = await clientFor(profe1)
      const { data, error } = await c.from('profes_aulas').select('id').eq('profe_id', profe2.id)
      expect(error).toBeNull()
      expect(data ?? []).toHaveLength(0)
    })

    it('dos coordinadoras activas en el mismo aula → 23505 por índice único parcial', async () => {
      // Intentamos colar una segunda coordinadora en aulaA1 (ya tiene a profe1).
      const otroProfe = await createTestUser({ nombre: 'Profe rival coordinadora' })
      await asignarRol(otroProfe.id, centroA.id, 'profe')
      const { error } = await serviceClient.from('profes_aulas').insert({
        profe_id: otroProfe.id,
        aula_id: aulaA1.id,
        curso_academico_id: aulaA1.curso_academico_id,
        fecha_inicio: '2026-09-01',
        tipo_personal_aula: 'coordinadora',
      })
      expect(error).not.toBeNull()
      expect(error?.code).toBe('23505')
      await deleteTestUser(otroProfe.id)
    })

    it('tutor del centro NO ve profes_aulas', async () => {
      const c = await clientFor(tutor)
      const { data, error } = await c
        .from('profes_aulas')
        .select('id')
        .in('aula_id', [aulaA1.id, aulaA2.id])
      expect(error).toBeNull()
      expect(data ?? []).toHaveLength(0)
    })

    // --- item 4: mutaciones de las nuevas actions bajo RLS ---

    it('admin del centro puede cambiar el tipo (UPDATE) de una asignación de su centro', async () => {
      const { data: row } = await serviceClient
        .from('profes_aulas')
        .select('id')
        .eq('profe_id', profe2.id)
        .eq('aula_id', aulaA2.id)
        .is('fecha_fin', null)
        .single()
      const c = await clientFor(adminA)
      const { data, error } = await c
        .from('profes_aulas')
        .update({ tipo_personal_aula: 'tecnico' })
        .eq('id', row!.id)
        .select('id')
        .maybeSingle()
      expect(error).toBeNull()
      expect(data?.id).toBe(row!.id)
      // revert
      await serviceClient
        .from('profes_aulas')
        .update({ tipo_personal_aula: 'profesora' })
        .eq('id', row!.id)
    })

    it('admin de OTRO centro NO puede actualizar profes_aulas cross-centro (0 filas)', async () => {
      const { data: row } = await serviceClient
        .from('profes_aulas')
        .select('id')
        .eq('profe_id', profe2.id)
        .eq('aula_id', aulaA2.id)
        .is('fecha_fin', null)
        .single()
      const c = await clientFor(adminB)
      const { data, error } = await c
        .from('profes_aulas')
        .update({ tipo_personal_aula: 'apoyo' })
        .eq('id', row!.id)
        .select('id')
      expect(error).toBeNull()
      expect(data ?? []).toHaveLength(0)
    })

    it('profe NO puede actualizar su asignación (sin policy UPDATE para profe)', async () => {
      const { data: row } = await serviceClient
        .from('profes_aulas')
        .select('id')
        .eq('profe_id', profe1.id)
        .eq('aula_id', aulaA1.id)
        .is('fecha_fin', null)
        .single()
      const c = await clientFor(profe1)
      const { data, error } = await c
        .from('profes_aulas')
        .update({ tipo_personal_aula: 'profesora' })
        .eq('id', row!.id)
        .select('id')
      expect(error).toBeNull()
      expect(data ?? []).toHaveLength(0)
      const { data: after } = await serviceClient
        .from('profes_aulas')
        .select('tipo_personal_aula')
        .eq('id', row!.id)
        .single()
      expect(after?.tipo_personal_aula).toBe('coordinadora')
    })

    it('admin: sustitución orden-seguro (degradar→promover) respeta el índice único', async () => {
      // Añadimos a profe2 a aulaA1 como profesora y lo promovemos a
      // coordinadora degradando antes a profe1 (coordinadora actual).
      const { data: nueva } = await serviceClient
        .from('profes_aulas')
        .insert({
          profe_id: profe2.id,
          aula_id: aulaA1.id,
          curso_academico_id: aulaA1.curso_academico_id,
          fecha_inicio: '2026-09-01',
          tipo_personal_aula: 'profesora',
        })
        .select('id')
        .single()
      const { data: coordActual } = await serviceClient
        .from('profes_aulas')
        .select('id')
        .eq('profe_id', profe1.id)
        .eq('aula_id', aulaA1.id)
        .is('fecha_fin', null)
        .single()

      const c = await clientFor(adminA)
      // 1. degradar primero
      const { error: e1 } = await c
        .from('profes_aulas')
        .update({ tipo_personal_aula: 'profesora' })
        .eq('id', coordActual!.id)
      expect(e1).toBeNull()
      // 2. promover después — sin 23505 porque ya no hay coordinadora
      const { data: promo, error: e2 } = await c
        .from('profes_aulas')
        .update({ tipo_personal_aula: 'coordinadora' })
        .eq('id', nueva!.id)
        .select('id')
        .maybeSingle()
      expect(e2).toBeNull()
      expect(promo?.id).toBe(nueva!.id)

      // cleanup: quitar la nueva y restaurar profe1 como coordinadora
      await serviceClient.from('profes_aulas').delete().eq('id', nueva!.id)
      await serviceClient
        .from('profes_aulas')
        .update({ tipo_personal_aula: 'coordinadora' })
        .eq('id', coordActual!.id)
    })
  }
)
