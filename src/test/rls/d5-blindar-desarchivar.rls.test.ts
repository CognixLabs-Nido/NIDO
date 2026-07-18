import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

import {
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
  serviceClient,
  type TestUser,
} from './setup'

/**
 * D-5 (punto 2) — Blindaje de desarchivar/reactivación con `deleted_reason`.
 *
 * desarchivar_nino y la rama de reactivación de crear_o_anadir_a_familia solo reviven lo
 * que borró una BAJA ('baja_nino' vínculos, 'revocacion_familia' rol/familia). La purga
 * RGPD marca 'purga_rgpd' → nunca revivible. CHECK de coherencia deleted_at ⇔ deleted_reason.
 *
 * Gate: D5_MIGRATION_APPLIED=1 (requiere 20260805 + primitivos F-3-C/D/F + F-2b-4-1 + olvido).
 */

const APPLIED = process.env.D5_MIGRATION_APPLIED === '1'

interface Escenario {
  centroId: string
  cursoId: string
  aulaId: string
}

describe.skipIf(!APPLIED)('D-5 punto 2 — blindar desarchivar (motivo_borrado)', () => {
  let admin: TestUser
  let cAdmin: SupabaseClient<Database>
  const centros: string[] = []
  const usuarios: string[] = []

  beforeAll(async () => {
    admin = await createTestUser({ nombre: 'Admin D5-2' })
    usuarios.push(admin.id)
    cAdmin = await clientFor(admin)
  }, 60_000)

  afterAll(async () => {
    for (const id of centros) await deleteTestCentro(id)
    for (const id of usuarios) await deleteTestUser(id)
  }, 120_000)

  async function nuevoEscenario(): Promise<Escenario> {
    const centro = await createTestCentro('Centro D5-2')
    centros.push(centro.id)
    await asignarRol(admin.id, centro.id, 'admin')
    const curso = await createTestCurso(centro.id, 'activo')
    const aula = await createTestAula(centro.id, curso.id)
    return { centroId: centro.id, cursoId: curso.id, aulaId: aula.id }
  }

  /** Niño (hijo único) con familia + matrícula pasada + tutor con cuenta (vínculo + rol). */
  async function crearNinoConTutor(e: Escenario): Promise<{
    ninoId: string
    familiaId: string
    tutor: TestUser
    vinculoId: string
  }> {
    const familiaId = await createTestFamilia(e.centroId)
    const { data: nino } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: e.centroId,
        familia_id: familiaId,
        nombre: 'Niño D5-2',
        apellidos: 'Test',
        fecha_nacimiento: '2024-03-15',
      })
      .select('id')
      .single()
    const ninoId = nino!.id
    await serviceClient.from('matriculas').insert({
      nino_id: ninoId,
      aula_id: e.aulaId,
      curso_academico_id: e.cursoId,
      fecha_alta: '2025-09-01',
    })
    const tutor = await createTestUser({ nombre: 'Tutor D5-2' })
    usuarios.push(tutor.id)
    await asignarRol(tutor.id, e.centroId, 'tutor_legal')
    await serviceClient
      .from('familia_tutores')
      .insert({ familia_id: familiaId, usuario_id: tutor.id, rol_familia: 'titular' })
    const vinculoId = await crearVinculo(ninoId, tutor.id, 'tutor_legal_principal')
    return { ninoId, familiaId, tutor, vinculoId }
  }

  async function vinculo(id: string) {
    const { data } = await serviceClient
      .from('vinculos_familiares')
      .select('deleted_at, deleted_reason')
      .eq('id', id)
      .single()
    return data!
  }
  async function rolTutor(usuarioId: string, centroId: string) {
    const { data } = await serviceClient
      .from('roles_usuario')
      .select('deleted_at, deleted_reason')
      .eq('usuario_id', usuarioId)
      .eq('centro_id', centroId)
      .eq('rol', 'tutor_legal')
      .single()
    return data!
  }
  async function familia(id: string) {
    const { data } = await serviceClient
      .from('familias')
      .select('deleted_at, deleted_reason')
      .eq('id', id)
      .single()
    return data!
  }
  async function nino(id: string) {
    const { data } = await serviceClient
      .from('ninos')
      .select('deleted_at, deleted_reason')
      .eq('id', id)
      .single()
    return data!
  }

  it('baja estampa los motivos; desarchivar revive todo y limpia deleted_reason a NULL', async () => {
    const e = await nuevoEscenario()
    const { ninoId, familiaId, tutor, vinculoId } = await crearNinoConTutor(e)

    const baja = await serviceClient.rpc('baja_nino', { p_nino_id: ninoId, p_motivo: 'x' })
    expect(baja.error).toBeNull()

    // Estampado por la baja (incluido el propio niño).
    expect(await nino(ninoId)).toMatchObject({ deleted_reason: 'baja_nino' })
    expect((await nino(ninoId)).deleted_at).not.toBeNull()
    expect(await vinculo(vinculoId)).toMatchObject({ deleted_reason: 'baja_nino' })
    expect((await vinculo(vinculoId)).deleted_at).not.toBeNull()
    expect(await rolTutor(tutor.id, e.centroId)).toMatchObject({
      deleted_reason: 'revocacion_familia',
    })
    expect(await familia(familiaId)).toMatchObject({ deleted_reason: 'revocacion_familia' })

    const des = await serviceClient.rpc('desarchivar_nino', {
      p_nino_id: ninoId,
      p_aula_id: e.aulaId,
    })
    expect(des.error).toBeNull()

    // Revivido + motivo a NULL (coherente con el CHECK), niño incluido.
    expect(await nino(ninoId)).toEqual({ deleted_at: null, deleted_reason: null })
    expect(await vinculo(vinculoId)).toEqual({ deleted_at: null, deleted_reason: null })
    expect(await rolTutor(tutor.id, e.centroId)).toEqual({ deleted_at: null, deleted_reason: null })
    expect(await familia(familiaId)).toEqual({ deleted_at: null, deleted_reason: null })
  })

  it('purgar un niño estampa "purga_rgpd" y desarchivar hace RAISE (no lo revive)', async () => {
    const e = await nuevoEscenario()
    const { ninoId } = await crearNinoConTutor(e)

    // Al SOLICITAR el olvido (antes de purgar): el niño queda oculto con 'solicitud_olvido'
    // (conserva PII; no está anonimizado aún). El CHECK exige motivo → esto valida el fix.
    const sol = await serviceClient.rpc('solicitar_olvido_nino', {
      p_nino_id: ninoId,
      p_inmediato: true,
    })
    expect(sol.error).toBeNull()
    expect(await nino(ninoId)).toMatchObject({ deleted_reason: 'solicitud_olvido' })
    expect((await nino(ninoId)).deleted_at).not.toBeNull()

    // Al PURGAR: se anonimiza y el motivo pasa a 'purga_rgpd'.
    const purga = await serviceClient.rpc('purgar_sujeto_db', {
      p_solicitud_id: sol.data as string,
    })
    expect(purga.error).toBeNull()
    expect(await nino(ninoId)).toMatchObject({ deleted_reason: 'purga_rgpd' })
    expect((await nino(ninoId)).deleted_at).not.toBeNull()

    // desarchivar → RAISE ('no se puede reincorporar a un sujeto purgado'); NADA cambia.
    const des = await serviceClient.rpc('desarchivar_nino', {
      p_nino_id: ninoId,
      p_aula_id: e.aulaId,
    })
    expect(des.error).not.toBeNull()
    expect(des.error?.message).toMatch(/purgad/i)
    expect((await nino(ninoId)).deleted_at).not.toBeNull() // sigue archivado
    expect(await nino(ninoId)).toMatchObject({ deleted_reason: 'purga_rgpd' })
  })

  it("purga RGPD marca 'purga_rgpd' y desarchivar NO lo revive (el bug del blindaje)", async () => {
    const e = await nuevoEscenario()
    const { ninoId, familiaId, tutor, vinculoId } = await crearNinoConTutor(e)

    // Solicita el olvido del TUTOR ANTES de la baja: solicitar_olvido_usuario deriva el
    // centro de un rol ACTIVO, y la baja revoca ese rol → hay que pedirlo mientras vive.
    const sol = await serviceClient.rpc('solicitar_olvido_usuario', {
      p_usuario_id: tutor.id,
      p_inmediato: true,
    })
    expect(sol.error).toBeNull()

    // Baja del hijo único → familia archivada + rol/vínculo soft-borrados por baja.
    await serviceClient.rpc('baja_nino', { p_nino_id: ninoId, p_motivo: 'x' })

    // Purga RGPD del TUTOR → sobreescribe el motivo de SUS vínculos/rol a 'purga_rgpd'.
    const purga = await serviceClient.rpc('purgar_sujeto_db', {
      p_solicitud_id: sol.data as string,
    })
    expect(purga.error).toBeNull()

    // La purga estampó 'purga_rgpd'.
    expect(await vinculo(vinculoId)).toMatchObject({ deleted_reason: 'purga_rgpd' })
    expect(await rolTutor(tutor.id, e.centroId)).toMatchObject({ deleted_reason: 'purga_rgpd' })

    // desarchivar NO revive lo purgado (vínculo + rol siguen borrados); la familia
    // (archivada por la baja, 'revocacion_familia') sí se reactiva.
    const des = await serviceClient.rpc('desarchivar_nino', {
      p_nino_id: ninoId,
      p_aula_id: e.aulaId,
    })
    expect(des.error).toBeNull()

    expect((await vinculo(vinculoId)).deleted_at).not.toBeNull() // NO revivido
    expect(await vinculo(vinculoId)).toMatchObject({ deleted_reason: 'purga_rgpd' })
    expect((await rolTutor(tutor.id, e.centroId)).deleted_at).not.toBeNull() // NO revivido
    expect(await familia(familiaId)).toEqual({ deleted_at: null, deleted_reason: null }) // sí reactivada
  })

  it('la reactivación de crear_o_anadir_a_familia respeta el mismo filtro de motivo', async () => {
    const e = await nuevoEscenario()
    const { ninoId, familiaId, tutor } = await crearNinoConTutor(e)

    await serviceClient.rpc('baja_nino', { p_nino_id: ninoId, p_motivo: 'x' })
    // Sintético: simula que la FAMILIA la archivó OTRA vía (no la baja). El brazo de la
    // familia en la reactivación filtra por 'revocacion_familia' → NO debe reactivarla,
    // mientras el rol (que sí es 'revocacion_familia') sí revive. (Se sella la familia, no
    // el rol, para no disparar el 23505 del INSERT de rol del paso 9 con un rol no revivido.)
    await serviceClient
      .from('familias')
      .update({ deleted_reason: 'purga_rgpd' })
      .eq('id', familiaId)

    // El tutor añade un 2º hijo → crea_o_anadir entra en la rama de reactivación.
    const add = await cAdmin.rpc('crear_o_anadir_a_familia', {
      p_nombre_nino: 'Segundo',
      p_apellidos_nino: 'Test',
      p_fecha_nacimiento: '2024-03-15',
      p_centro_id: e.centroId,
      p_aula_id: e.aulaId,
      p_tutor_email: tutor.email,
      p_tutor_nombre_completo: 'Tutor D5-2',
      p_parentesco: 'madre',
      p_descripcion_parentesco: '',
      p_usuario_id: tutor.id,
      p_permisos: {},
    })
    expect(add.error).toBeNull()

    // Filtro respetado: la familia con motivo ≠ 'revocacion_familia' NO se reactiva;
    // el rol (motivo 'revocacion_familia') sí revive y se limpia el motivo.
    expect((await familia(familiaId)).deleted_at).not.toBeNull() // NO reactivada (filtro)
    expect(await familia(familiaId)).toMatchObject({ deleted_reason: 'purga_rgpd' })
    expect(await rolTutor(tutor.id, e.centroId)).toEqual({ deleted_at: null, deleted_reason: null })
  })

  it('el CHECK rechaza deleted_at sin motivo y motivo sin deleted_at', async () => {
    const e = await nuevoEscenario()
    const { vinculoId } = await crearNinoConTutor(e)

    // deleted_at sin motivo → viola el CHECK.
    const a = await serviceClient
      .from('vinculos_familiares')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', vinculoId)
      .select('id')
    expect(a.error?.code).toBe('23514')

    // motivo sin deleted_at → viola el CHECK.
    const b = await serviceClient
      .from('vinculos_familiares')
      .update({ deleted_reason: 'baja_nino' })
      .eq('id', vinculoId)
      .select('id')
    expect(b.error?.code).toBe('23514')
  })
})
