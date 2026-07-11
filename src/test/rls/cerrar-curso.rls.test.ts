import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarProfeAula,
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestFamilia,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * F-3-C-2 — RPC orquestadora `cerrar_curso` (cierre de curso todo-o-nada).
 *
 *  1. finaliza → archivado (niño soft-borrado, matrícula 'baja', vínculos borrados).
 *  2. finaliza último hijo → familia inactiva + tutor sin acceso (rol revocado).
 *  3. finaliza con hermano activo → familia NO revocada (guard protege).
 *  4. continúa → matrícula VIEJA cerrada, la NUEVA del destino intacta ('activa').
 *  5. profes_aulas vieja del saliente cerrada (fecha_fin puesto).
 *  6. TODO-O-NADA: forzar fallo en un niño → rollback total (curso NO cerrado,
 *     nada archivado, filas rollover_finaliza intactas).
 *  7. idempotencia: 2.ª llamada tras cierre OK → ya_activo:true, estado consistente.
 *  8. actor de auditoría = admin (audit_log.usuario_id del archivado = admin.id).
 *
 * Gate: F3C2_MIGRATION_APPLIED=1 (requiere 20260719120000 — y la dependencia
 * 20260718120000 revocar_acceso_familia + 20260717120000 archivar_nino — aplicadas).
 */

const APPLIED = process.env.F3C2_MIGRATION_APPLIED === '1'

const SALIENTE_FIN = '2027-07-31' // = createTestCurso fecha_fin
const ALTA = '2026-09-01' // = createTestCurso fecha_inicio / matricular fecha_alta

interface Escenario {
  centroId: string
  salienteId: string
  destinoId: string
  aulaSaliente: { id: string }
  aulaDestino: { id: string }
}

describe.skipIf(!APPLIED)('F-3-C-2 — cerrar_curso (RPC)', () => {
  let admin: TestUser
  let cAdmin: SupabaseClient<Database>
  const centros: string[] = []
  const usuarios: string[] = []

  beforeAll(async () => {
    admin = await createTestUser({ nombre: 'Admin F3C2' })
    usuarios.push(admin.id)
    cAdmin = await clientFor(admin)
  }, 60_000)

  afterAll(async () => {
    for (const id of centros) await deleteTestCentro(id)
    for (const id of usuarios) await deleteTestUser(id)
  }, 120_000)

  /** Crea un centro con curso saliente (activo) + destino (planificado) y un aula en cada uno. */
  async function nuevoEscenario(): Promise<Escenario> {
    const centro = await createTestCentro('Centro F3C2')
    centros.push(centro.id)
    await asignarRol(admin.id, centro.id, 'admin')
    const saliente = await createTestCurso(centro.id, 'activo')
    const destino = await createTestCurso(centro.id, 'planificado')
    const aulaSaliente = await createTestAula(centro.id, saliente.id)
    const aulaDestino = await createTestAula(centro.id, destino.id)
    return {
      centroId: centro.id,
      salienteId: saliente.id,
      destinoId: destino.id,
      aulaSaliente,
      aulaDestino,
    }
  }

  /** Niño con familia + matrícula ACTIVA en el saliente. Devuelve ids. */
  async function ninoEnSaliente(
    e: Escenario,
    opts: { fechaAlta?: string } = {}
  ): Promise<{ ninoId: string; familiaId: string }> {
    const familiaId = await createTestFamilia(e.centroId)
    const { data: nino } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: e.centroId,
        familia_id: familiaId,
        nombre: 'Niño F3C2',
        apellidos: 'Test',
        fecha_nacimiento: '2024-03-15',
      })
      .select('id')
      .single()
    const ninoId = nino!.id
    await serviceClient.from('matriculas').insert({
      nino_id: ninoId,
      aula_id: e.aulaSaliente.id,
      curso_academico_id: e.salienteId,
      fecha_alta: opts.fechaAlta ?? ALTA,
    })
    return { ninoId, familiaId }
  }

  /** Marca un niño como "Finaliza" en el destino (fila rollover_finaliza). */
  async function marcarFinaliza(e: Escenario, ninoId: string): Promise<void> {
    const { error } = await serviceClient
      .from('rollover_finaliza')
      .insert({ centro_id: e.centroId, curso_academico_id: e.destinoId, nino_id: ninoId })
    if (error) throw new Error(`marcarFinaliza falló: ${error.message}`)
  }

  /** Crea la matrícula PENDIENTE del destino (el "continúa"). */
  async function pendienteEnDestino(e: Escenario, ninoId: string): Promise<string> {
    const { data, error } = await serviceClient
      .from('matriculas')
      .insert({
        nino_id: ninoId,
        aula_id: e.aulaDestino.id,
        curso_academico_id: e.destinoId,
        estado: 'pendiente',
        fecha_alta: ALTA,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`pendienteEnDestino falló: ${error?.message}`)
    return data.id
  }

  /** Añade un tutor con cuenta (rol tutor_legal + familia_tutores + vínculo). */
  async function nuevoTutor(
    e: Escenario,
    familiaId: string,
    ninoId: string,
    rolFamilia: 'titular' | 'segundo_tutor'
  ): Promise<TestUser> {
    const u = await createTestUser({ nombre: 'Tutor F3C2' })
    usuarios.push(u.id)
    await asignarRol(u.id, e.centroId, 'tutor_legal')
    await serviceClient
      .from('familia_tutores')
      .insert({ familia_id: familiaId, usuario_id: u.id, rol_familia: rolFamilia })
    await crearVinculo(ninoId, u.id, 'tutor_legal_principal')
    return u
  }

  async function estadoCurso(cursoId: string): Promise<string> {
    const { data } = await serviceClient
      .from('cursos_academicos')
      .select('estado')
      .eq('id', cursoId)
      .single()
    return data!.estado
  }

  async function matriculaDe(
    ninoId: string,
    cursoId: string
  ): Promise<{ estado: string; fecha_baja: string | null } | null> {
    const { data } = await serviceClient
      .from('matriculas')
      .select('estado, fecha_baja')
      .eq('nino_id', ninoId)
      .eq('curso_academico_id', cursoId)
      .maybeSingle()
    return data ?? null
  }

  async function rolesActivos(usuarioIds: string[]): Promise<number> {
    const { data } = await serviceClient
      .from('roles_usuario')
      .select('id')
      .eq('rol', 'tutor_legal')
      .in('usuario_id', usuarioIds)
      .is('deleted_at', null)
    return (data ?? []).length
  }

  it('finaliza → niño archivado (matrícula baja, vínculos borrados)', async () => {
    const e = await nuevoEscenario()
    const { ninoId, familiaId } = await ninoEnSaliente(e)
    await nuevoTutor(e, familiaId, ninoId, 'titular')
    await marcarFinaliza(e, ninoId)

    const { data, error } = await cAdmin.rpc('cerrar_curso', { p_curso_destino_id: e.destinoId })
    expect(error).toBeNull()
    expect(data).toMatchObject({ cerrado: true, finalizados: 1 })

    const { data: nino } = await serviceClient
      .from('ninos')
      .select('deleted_at')
      .eq('id', ninoId)
      .single()
    expect(nino!.deleted_at).not.toBeNull()

    const mat = await matriculaDe(ninoId, e.salienteId)
    expect(mat).toMatchObject({ estado: 'baja', fecha_baja: SALIENTE_FIN })

    const { data: vinc } = await serviceClient
      .from('vinculos_familiares')
      .select('deleted_at')
      .eq('nino_id', ninoId)
    expect(vinc!.every((v) => v.deleted_at !== null)).toBe(true)
  })

  it('finaliza último hijo → familia inactiva + tutor sin acceso', async () => {
    const e = await nuevoEscenario()
    const { ninoId, familiaId } = await ninoEnSaliente(e)
    const tutor = await nuevoTutor(e, familiaId, ninoId, 'titular')
    await marcarFinaliza(e, ninoId)

    const { data, error } = await cAdmin.rpc('cerrar_curso', { p_curso_destino_id: e.destinoId })
    expect(error).toBeNull()
    expect(data).toMatchObject({ cerrado: true, finalizados: 1, familias_revocadas: 1 })

    const { data: fam } = await serviceClient
      .from('familias')
      .select('deleted_at')
      .eq('id', familiaId)
      .single()
    expect(fam!.deleted_at).not.toBeNull()
    expect(await rolesActivos([tutor.id])).toBe(0)
  })

  it('finaliza con hermano activo → familia NO revocada', async () => {
    const e = await nuevoEscenario()
    // Dos hermanos misma familia: uno finaliza, otro continúa.
    const familiaId = await createTestFamilia(e.centroId)
    const insNino = async (nombre: string) => {
      const { data } = await serviceClient
        .from('ninos')
        .insert({
          centro_id: e.centroId,
          familia_id: familiaId,
          nombre,
          apellidos: 'Test',
          fecha_nacimiento: '2024-03-15',
        })
        .select('id')
        .single()
      await serviceClient.from('matriculas').insert({
        nino_id: data!.id,
        aula_id: e.aulaSaliente.id,
        curso_academico_id: e.salienteId,
        fecha_alta: ALTA,
      })
      return data!.id
    }
    const ninoFinaliza = await insNino('Hermano Finaliza')
    const ninoContinua = await insNino('Hermano Continúa')
    const tutor = await nuevoTutor(e, familiaId, ninoContinua, 'titular')
    await marcarFinaliza(e, ninoFinaliza)
    await pendienteEnDestino(e, ninoContinua)

    const { data, error } = await cAdmin.rpc('cerrar_curso', { p_curso_destino_id: e.destinoId })
    expect(error).toBeNull()
    expect(data).toMatchObject({ cerrado: true, finalizados: 1, familias_revocadas: 0 })

    const { data: fam } = await serviceClient
      .from('familias')
      .select('deleted_at')
      .eq('id', familiaId)
      .single()
    expect(fam!.deleted_at).toBeNull() // hermano que continúa protege
    expect(await rolesActivos([tutor.id])).toBe(1)
  })

  it('continúa → matrícula vieja cerrada, la nueva del destino intacta', async () => {
    const e = await nuevoEscenario()
    const { ninoId, familiaId } = await ninoEnSaliente(e)
    await nuevoTutor(e, familiaId, ninoId, 'titular')
    await pendienteEnDestino(e, ninoId)

    const { data, error } = await cAdmin.rpc('cerrar_curso', { p_curso_destino_id: e.destinoId })
    expect(error).toBeNull()
    expect(data).toMatchObject({ cerrado: true, matriculas_continuan_cerradas: 1 })

    const vieja = await matriculaDe(ninoId, e.salienteId)
    expect(vieja).toMatchObject({ estado: 'baja', fecha_baja: SALIENTE_FIN })
    const nueva = await matriculaDe(ninoId, e.destinoId)
    expect(nueva).toMatchObject({ estado: 'activa', fecha_baja: null })
  })

  it('profes_aulas vieja del saliente cerrada', async () => {
    const e = await nuevoEscenario()
    const profe = await createTestUser({ nombre: 'Profe F3C2' })
    usuarios.push(profe.id)
    await asignarRol(profe.id, e.centroId, 'profe')
    const paId = await asignarProfeAula(profe.id, e.aulaSaliente.id, e.salienteId)

    const { error } = await cAdmin.rpc('cerrar_curso', { p_curso_destino_id: e.destinoId })
    expect(error).toBeNull()

    const { data: pa } = await serviceClient
      .from('profes_aulas')
      .select('fecha_fin')
      .eq('id', paId)
      .single()
    expect(pa!.fecha_fin).toBe(SALIENTE_FIN)
  })

  it('TODO-O-NADA: fallo en un niño → rollback total, curso NO cerrado', async () => {
    const e = await nuevoEscenario()
    // Finalizador "bueno".
    const bueno = await ninoEnSaliente(e)
    await marcarFinaliza(e, bueno.ninoId)
    // Finalizador "malo": matrícula con fecha_alta POSTERIOR a fecha_fin → al
    // archivar (fecha_baja=fin de curso) viola CHECK(fecha_baja >= fecha_alta) →
    // RAISE dentro de archivar_nino → rollback total (sin bloque EXCEPTION).
    const malo = await ninoEnSaliente(e, { fechaAlta: '2027-08-15' })
    await marcarFinaliza(e, malo.ninoId)

    const { error } = await cAdmin.rpc('cerrar_curso', { p_curso_destino_id: e.destinoId })
    expect(error).not.toBeNull() // el error crudo propaga

    // Nada archivado, curso NO cerrado, filas rollover_finaliza intactas.
    const { data: ninos } = await serviceClient
      .from('ninos')
      .select('deleted_at')
      .in('id', [bueno.ninoId, malo.ninoId])
    expect(ninos!.every((n) => n.deleted_at === null)).toBe(true)
    expect(await estadoCurso(e.destinoId)).toBe('planificado')
    expect(await estadoCurso(e.salienteId)).toBe('activo')
    const { data: rf } = await serviceClient
      .from('rollover_finaliza')
      .select('id')
      .eq('curso_academico_id', e.destinoId)
    expect((rf ?? []).length).toBe(2)
  })

  it('idempotencia: 2.ª llamada tras cierre OK → ya_activo', async () => {
    const e = await nuevoEscenario()
    const { ninoId, familiaId } = await ninoEnSaliente(e)
    await nuevoTutor(e, familiaId, ninoId, 'titular')
    await pendienteEnDestino(e, ninoId)

    const first = await cAdmin.rpc('cerrar_curso', { p_curso_destino_id: e.destinoId })
    expect(first.error).toBeNull()
    expect(first.data).toMatchObject({ cerrado: true })

    const second = await cAdmin.rpc('cerrar_curso', { p_curso_destino_id: e.destinoId })
    expect(second.error).toBeNull()
    expect(second.data).toMatchObject({ cerrado: false, ya_activo: true })

    // El estado quedó consistente tras la 1.ª (no lo alteró la 2.ª).
    expect(await estadoCurso(e.destinoId)).toBe('activo')
    expect(await estadoCurso(e.salienteId)).toBe('cerrado')
  })

  it('actor de auditoría = admin', async () => {
    const e = await nuevoEscenario()
    const { ninoId, familiaId } = await ninoEnSaliente(e)
    await nuevoTutor(e, familiaId, ninoId, 'titular')
    await marcarFinaliza(e, ninoId)

    const { error } = await cAdmin.rpc('cerrar_curso', { p_curso_destino_id: e.destinoId })
    expect(error).toBeNull()

    // El UPDATE de ninos.deleted_at (archivado) lo audita el trigger con auth.uid().
    const { data: filas } = await serviceClient
      .from('audit_log')
      .select('usuario_id, accion')
      .eq('tabla', 'ninos')
      .eq('registro_id', ninoId)
      .eq('accion', 'UPDATE')
    expect((filas ?? []).some((f) => f.usuario_id === admin.id)).toBe(true)
  })
})
