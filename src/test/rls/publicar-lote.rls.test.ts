import { randomUUID } from 'crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * RLS del **publicar en lote** (F9-5-3). El lote reusa `publicarInforme`, cuya
 * autorización es la policy `informes_evolucion_update`: redactora (coordinadora/
 * profesora) de su aula o admin del centro publican; técnico/apoyo y staff de otra
 * aula/centro NO. Este test ejerce ese UPDATE (borrador→publicado) bajo la sesión
 * de cada rol y el patrón de sellado de `notificado_at` (avisar una sola vez, Q8).
 *
 * **Gated** por `F9_0_MIGRATION_APPLIED=1` (tablas de informes, F9-0; sin migración
 * propia en F9-5-3). Comando:
 *   F9_0_MIGRATION_APPLIED=1 npm run test:rls -- publicar-lote.rls
 */
const MIGRATION_APPLIED = process.env.F9_0_MIGRATION_APPLIED === '1'

type PlantillaInsert = Database['public']['Tables']['plantillas_informe']['Insert']
type TipoPersonalAula = Database['public']['Enums']['tipo_personal_aula']

const ESTRUCTURA = [{ titulo: 'Autonomía', items: [{ id: 'item-1', texto: 'Come solo' }] }]
// Respuestas COMPLETAS (todos los ítems valorados) → publicable.
const RESPUESTAS_COMPLETAS = { 'item-1': { valoracion: 'conseguido' } }

describe.skipIf(!MIGRATION_APPLIED)('RLS publicar en lote — F9-5-3', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let aulaB: { id: string }

  let admin: TestUser
  let coordinadora: TestUser
  let tecnico: TestUser
  let coordinadoraB: TestUser

  let plantilla: string
  const creados: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro Lote')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id, 'Aula Lote')
    aulaB = await createTestAula(centro.id, curso.id, 'Aula Lote B')

    admin = await createTestUser({ nombre: 'Admin Lote' })
    coordinadora = await createTestUser({ nombre: 'Coord Lote' })
    tecnico = await createTestUser({ nombre: 'Tecnico Lote' })
    coordinadoraB = await createTestUser({ nombre: 'Coord Lote B' })

    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(coordinadora.id, centro.id, 'profe')
    await asignarRol(tecnico.id, centro.id, 'profe')
    await asignarRol(coordinadoraB.id, centro.id, 'profe')

    await asignarProfeConTipo(coordinadora.id, aula.id, 'coordinadora')
    await asignarProfeConTipo(tecnico.id, aula.id, 'tecnico')
    await asignarProfeConTipo(coordinadoraB.id, aulaB.id, 'coordinadora')

    const payload: PlantillaInsert = {
      centro_id: centro.id,
      titulo: `Plantilla ${randomUUID().slice(0, 8)}`,
      estructura: ESTRUCTURA,
      creado_por: admin.id,
    }
    const { data, error } = await serviceClient
      .from('plantillas_informe')
      .insert(payload)
      .select('id')
      .single()
    if (error || !data) throw new Error(`crearPlantilla falló: ${error?.message}`)
    plantilla = data.id
  })

  afterAll(async () => {
    for (const id of creados) await serviceClient.from('informes_evolucion').delete().eq('id', id)
    await serviceClient.from('plantillas_informe').delete().eq('id', plantilla)
    await deleteTestCentro(centro.id)
    for (const u of [admin, coordinadora, tecnico, coordinadoraB]) await deleteTestUser(u.id)
  })

  async function asignarProfeConTipo(
    profe_id: string,
    aula_id: string,
    tipo: TipoPersonalAula
  ): Promise<void> {
    const { data: ac } = await serviceClient
      .from('aulas_curso')
      .select('curso_academico_id')
      .eq('aula_id', aula_id)
      .limit(1)
      .maybeSingle()
    const { error } = await serviceClient.from('profes_aulas').insert({
      profe_id,
      aula_id,
      curso_academico_id: ac!.curso_academico_id,
      fecha_inicio: '2026-09-01',
      tipo_personal_aula: tipo,
    })
    if (error) throw new Error(`asignarProfeConTipo falló: ${error.message}`)
  }

  /** Crea un niño matriculado en `aula_id` con un informe BORRADOR completo. */
  async function nuevoBorrador(aula_id: string): Promise<{ ninoId: string; informeId: string }> {
    const nino = await createTestNino(centro.id)
    await matricular(nino.id, aula_id, curso.id)
    const { data, error } = await serviceClient
      .from('informes_evolucion')
      .insert({
        centro_id: centro.id,
        nino_id: nino.id,
        curso_academico_id: curso.id,
        periodo: 'trimestre_1',
        plantilla_id: plantilla,
        estructura_snapshot: ESTRUCTURA,
        respuestas: RESPUESTAS_COMPLETAS,
        estado: 'borrador',
        creado_por: admin.id,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`nuevoBorrador falló: ${error?.message}`)
    creados.push(data.id)
    return { ninoId: nino.id, informeId: data.id }
  }

  /** Publica como el rol dado (espejo de `publicarInforme`: estado + sellos). */
  async function publicarComo(user: TestUser, informeId: string, notificadoPrevio: string | null) {
    const c = await clientFor(user)
    return c
      .from('informes_evolucion')
      .update({
        estado: 'publicado',
        publicado_at: new Date().toISOString(),
        notificado_at: notificadoPrevio ?? new Date().toISOString(),
      })
      .eq('id', informeId)
      .select('id, estado, notificado_at')
      .maybeSingle()
  }

  it('la coordinadora publica el borrador completo de su aula', async () => {
    const { informeId } = await nuevoBorrador(aula.id)
    const { data, error } = await publicarComo(coordinadora, informeId, null)
    expect(error).toBeNull()
    expect(data?.estado).toBe('publicado')
    expect(data?.notificado_at).toBeTruthy()
  })

  it('la dirección (admin) publica el borrador del centro', async () => {
    const { informeId } = await nuevoBorrador(aula.id)
    const { data } = await publicarComo(admin, informeId, null)
    expect(data?.estado).toBe('publicado')
  })

  it('técnico NO puede publicar (RLS update lo deniega → 0 filas)', async () => {
    const { informeId } = await nuevoBorrador(aula.id)
    const { data } = await publicarComo(tecnico, informeId, null)
    expect(data).toBeNull() // USING falso → 0 filas
    const check = await serviceClient
      .from('informes_evolucion')
      .select('estado')
      .eq('id', informeId)
      .single()
    expect(check.data?.estado).toBe('borrador') // sigue sin publicar
  })

  it('una redactora de OTRA aula no publica informes ajenos', async () => {
    const { informeId } = await nuevoBorrador(aula.id)
    const { data } = await publicarComo(coordinadoraB, informeId, null)
    expect(data).toBeNull()
    const check = await serviceClient
      .from('informes_evolucion')
      .select('estado')
      .eq('id', informeId)
      .single()
    expect(check.data?.estado).toBe('borrador')
  })

  it('avisa una sola vez: republicar conserva notificado_at (Q8)', async () => {
    const { informeId } = await nuevoBorrador(aula.id)
    const pub1 = await publicarComo(coordinadora, informeId, null)
    const sello = pub1.data?.notificado_at as string
    expect(sello).toBeTruthy()

    // Despublicar (notificado_at NO se toca).
    const c = await clientFor(coordinadora)
    await c
      .from('informes_evolucion')
      .update({ estado: 'borrador', publicado_at: null })
      .eq('id', informeId)

    // Republicar pasando el sello previo → se conserva (no re-avisa).
    const pub2 = await publicarComo(coordinadora, informeId, sello)
    expect(pub2.data?.notificado_at).toBe(sello)
  })
})
