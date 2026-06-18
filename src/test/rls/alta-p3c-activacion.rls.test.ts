import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestAula,
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

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * F11 · Alta tutor-driven · Pieza 3c — activación de matrícula.
 *
 * Migraciones 20260617120000 (ENUM 'lista') + 20260617120100 (RPC
 * `marcar_matricula_lista`). Verifica:
 *   1. RPC `marcar_matricula_lista` (el tutor LEGAL finaliza: pendiente → lista):
 *      - tutor legal + identidad completa → 'lista';
 *      - idempotente (2.ª llamada → null, sigue 'lista');
 *      - sin identidad (apellidos null) → null, sigue 'pendiente' (backstop);
 *      - 'autorizado' (no es tutor legal) → rechazada (es_tutor_legal_de).
 *   2. Guard de activarMatricula (a nivel RLS/DB): admin solo activa una 'lista'
 *      (no una 'pendiente') — espejo del `.eq('estado','lista')` de la action.
 *
 * Gateado: F11_ALTA_P3C_MIGRATION_APPLIED=1
 */

const APPLIED = process.env.F11_ALTA_P3C_MIGRATION_APPLIED === '1'

async function crearMatriculaPendiente(
  ninoId: string,
  aulaId: string,
  cursoId: string
): Promise<string> {
  const { data: mat, error } = await serviceClient
    .from('matriculas')
    .insert({
      nino_id: ninoId,
      aula_id: aulaId,
      curso_academico_id: cursoId,
      fecha_alta: '2026-09-01',
      estado: 'pendiente',
    })
    .select('id')
    .single()
  if (error || !mat) throw new Error(`matricula pendiente: ${error?.message}`)
  return mat.id
}

describe.skipIf(!APPLIED)('Alta P3c — activación de matrícula (RPC + guard)', () => {
  let centro: { id: string }
  let ninoOk: { id: string }
  let ninoSinId: { id: string }
  let matOk: string
  let matSinId: string
  let tutorLegal: TestUser
  let autorizado: TestUser
  let admin: TestUser
  let clientTutor: SupabaseClient<Database>
  let clientAutorizado: SupabaseClient<Database>
  let clientAdmin: SupabaseClient<Database>

  beforeAll(async () => {
    centro = await createTestCentro('Centro Alta P3c')
    ninoOk = await createTestNino(centro.id, 'Nino OK P3c') // identidad completa (helper)
    ninoSinId = await createTestNino(centro.id, 'Nino SinId P3c')
    // ninoSinId: identidad incompleta → backstop debe impedir 'lista'.
    await serviceClient
      .from('ninos')
      .update({ apellidos: null, fecha_nacimiento: null })
      .eq('id', ninoSinId.id)

    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id, 'Aula P3c')
    matOk = await crearMatriculaPendiente(ninoOk.id, aula.id, curso.id)
    matSinId = await crearMatriculaPendiente(ninoSinId.id, aula.id, curso.id)

    tutorLegal = await createTestUser({ nombre: 'Tutor Legal 3c' })
    autorizado = await createTestUser({ nombre: 'Autorizado 3c' })
    admin = await createTestUser({ nombre: 'Admin 3c' })
    await asignarRol(tutorLegal.id, centro.id, 'tutor_legal')
    await asignarRol(autorizado.id, centro.id, 'autorizado')
    await asignarRol(admin.id, centro.id, 'admin')
    await crearVinculo(ninoOk.id, tutorLegal.id, 'tutor_legal_principal', {})
    await crearVinculo(ninoSinId.id, tutorLegal.id, 'tutor_legal_principal', {})
    await crearVinculo(ninoOk.id, autorizado.id, 'autorizado', {})

    clientTutor = await clientFor(tutorLegal)
    clientAutorizado = await clientFor(autorizado)
    clientAdmin = await clientFor(admin)
  }, 90_000)

  afterAll(async () => {
    const usuarios = [tutorLegal?.id, autorizado?.id, admin?.id].filter((u): u is string =>
      Boolean(u)
    )
    await serviceClient.from('vinculos_familiares').delete().in('usuario_id', usuarios)
    await serviceClient.from('roles_usuario').delete().in('usuario_id', usuarios)
    for (const u of usuarios) await deleteTestUser(u)
    // El centro cascadea matriculas/ninos/aulas/cursos (FK CASCADE); roles ya borrados.
    await deleteTestCentro(centro.id)
  }, 60_000)

  async function estadoDe(matId: string): Promise<string | null> {
    const { data } = await serviceClient
      .from('matriculas')
      .select('estado')
      .eq('id', matId)
      .single()
    return data?.estado ?? null
  }

  it('tutor legal con identidad completa finaliza: pendiente → lista', async () => {
    const { data, error } = await clientTutor.rpc('marcar_matricula_lista', {
      p_nino_id: ninoOk.id,
    })
    expect(error).toBeNull()
    expect(data).toBe(matOk)
    expect(await estadoDe(matOk)).toBe('lista')
  })

  it('idempotente: 2.ª llamada estando ya lista → null, sigue lista', async () => {
    const { data, error } = await clientTutor.rpc('marcar_matricula_lista', {
      p_nino_id: ninoOk.id,
    })
    expect(error).toBeNull()
    expect(data).toBeNull()
    expect(await estadoDe(matOk)).toBe('lista')
  })

  it('sin identidad (apellidos/fecha null) → backstop: null, sigue pendiente', async () => {
    const { data, error } = await clientTutor.rpc('marcar_matricula_lista', {
      p_nino_id: ninoSinId.id,
    })
    expect(error).toBeNull()
    expect(data).toBeNull()
    expect(await estadoDe(matSinId)).toBe('pendiente')
  })

  it("'autorizado' (no es tutor legal) NO puede finalizar → rechazada", async () => {
    const { error } = await clientAutorizado.rpc('marcar_matricula_lista', { p_nino_id: ninoOk.id })
    expect(error).not.toBeNull() // es_tutor_legal_de false → RAISE insufficient_privilege
  })

  it('guard activarMatricula: admin NO activa una pendiente (0 filas)', async () => {
    const { data } = await clientAdmin
      .from('matriculas')
      .update({ estado: 'activa' })
      .eq('id', matSinId) // sigue 'pendiente'
      .eq('estado', 'lista')
      .select('id')
    expect(data ?? []).toHaveLength(0)
    expect(await estadoDe(matSinId)).toBe('pendiente')
  })

  it('guard activarMatricula: admin SÍ activa una lista (lista → activa)', async () => {
    const { data, error } = await clientAdmin
      .from('matriculas')
      .update({ estado: 'activa' })
      .eq('id', matOk) // está 'lista'
      .eq('estado', 'lista')
      .select('id')
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.id).toBe(matOk)
    expect(await estadoDe(matOk)).toBe('activa')
  })
})
