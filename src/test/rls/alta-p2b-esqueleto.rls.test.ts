import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createTestAula,
  createTestCentro,
  createTestCurso,
  deleteTestCentro,
  serviceClient,
} from './setup'

/**
 * F11 · Alta tutor-driven · Pieza 2b — esqueleto + matrícula pendiente + activación.
 *
 * Migración 20260616160000_phase11_alta_p2b_ninos_nullable (apellidos/fecha_nacimiento
 * pasan a NULL). Verifica los contratos de datos de la pieza:
 *   1. Se puede insertar un ESQUELETO de niño con apellidos/fecha_nacimiento NULL.
 *   2. La matrícula del esqueleto nace 'pendiente' (fecha_baja NULL).
 *   3. "Activar matrícula" = UPDATE estado pendiente→activa (lo que la pieza 2a deja
 *      entrar en operativas).
 *
 * La orquestación (`invitarFamiliaConEsqueleto`, `activarMatricula`) usa createClient/
 * next/headers → no invocable en vitest; se verifica en preview. El dedupe nino_id-aware
 * tiene su propio test unit con mocks (`send-invitation.dedupe.test.ts`).
 *
 * Gateado: F11_ALTA_P2B_MIGRATION_APPLIED=1
 */

const APPLIED = process.env.F11_ALTA_P2B_MIGRATION_APPLIED === '1'

describe.skipIf(!APPLIED)('Alta P2b — esqueleto (DB)', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string; curso_academico_id: string }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Alta P2b')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
  })

  afterAll(async () => {
    await deleteTestCentro(centro.id)
  })

  it('inserta un esqueleto de niño con apellidos/fecha_nacimiento NULL', async () => {
    const { data: nino, error } = await serviceClient
      .from('ninos')
      .insert({ centro_id: centro.id, nombre: 'Esqueleto Demo' })
      .select('id, nombre, apellidos, fecha_nacimiento')
      .single()
    expect(error).toBeNull()
    expect(nino?.apellidos).toBeNull()
    expect(nino?.fecha_nacimiento).toBeNull()

    if (nino) {
      await serviceClient.from('ninos').delete().eq('id', nino.id)
    }
  })

  it('matrícula del esqueleto nace pendiente y se activa con UPDATE estado', async () => {
    const { data: nino } = await serviceClient
      .from('ninos')
      .insert({ centro_id: centro.id, nombre: 'Esqueleto Activar' })
      .select('id')
      .single()
    expect(nino).not.toBeNull()
    const ninoId = nino!.id

    const hoy = '2026-09-01'
    const { data: mat, error: matErr } = await serviceClient
      .from('matriculas')
      .insert({
        nino_id: ninoId,
        aula_id: aula.id,
        curso_academico_id: aula.curso_academico_id,
        fecha_alta: hoy,
        estado: 'pendiente',
      })
      .select('id, estado, fecha_baja')
      .single()
    expect(matErr).toBeNull()
    expect(mat?.estado).toBe('pendiente')
    expect(mat?.fecha_baja).toBeNull()

    // "Activar matrícula": pendiente → activa (idempotencia por .eq('estado','pendiente')).
    const { data: activada } = await serviceClient
      .from('matriculas')
      .update({ estado: 'activa' })
      .eq('id', mat!.id)
      .eq('estado', 'pendiente')
      .select('id, estado')
      .maybeSingle()
    expect(activada?.estado).toBe('activa')

    // Re-activar no encuentra fila pendiente (idempotente).
    const { data: reintento } = await serviceClient
      .from('matriculas')
      .update({ estado: 'activa' })
      .eq('id', mat!.id)
      .eq('estado', 'pendiente')
      .select('id')
      .maybeSingle()
    expect(reintento).toBeNull()

    await serviceClient.from('matriculas').delete().eq('id', mat!.id)
    await serviceClient.from('ninos').delete().eq('id', ninoId)
  })
})
