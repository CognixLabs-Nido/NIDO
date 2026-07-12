import { randomUUID } from 'crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * F-3-F — RPC orquestadora `desarchivar_nino` (reincorporar, INVERSO de baja_nino).
 *
 *  (a) familia activa con hermano → baja de un hijo (familia NO revocada) → desarchivar
 *      → niño activo + matrícula nueva + vínculo revivido; familia y rol NUNCA tocados.
 *  (b) hijo único → baja (familia archivada + rol revocado) → desarchivar → familia
 *      reactivada + rol tutor_legal revivido + vínculo revivido + matrícula nueva.
 *  - matrícula nueva es del curso ACTIVO (estado activa, fecha_alta hoy); la vieja
 *    sigue en estado='baja' (historial preservado → 2 filas).
 *  - idempotencia → desarchivar un niño ya activo → { ya_activo: true }, 0 cambios.
 *  - authz → profe/tutor error; admin OK; service_role OK.
 *  - sin curso activo → error.
 *  - aula inválida (no en aulas_curso del curso activo) → error.
 *  - atomicidad → fallo (aula inválida) → NADA cambió (niño/familia/rol/matrículas intactos).
 *
 * Gate: F3F_MIGRATION_APPLIED=1 (requiere 20260722120000 + los primitivos de F-3-C/D).
 */

const APPLIED = process.env.F3F_MIGRATION_APPLIED === '1'

interface Escenario {
  centroId: string
  cursoId: string
  aulaId: string
}

describe.skipIf(!APPLIED)('F-3-F — desarchivar_nino (RPC)', () => {
  let admin: TestUser
  let cAdmin: SupabaseClient<Database>
  const centros: string[] = []
  const usuarios: string[] = []

  beforeAll(async () => {
    admin = await createTestUser({ nombre: 'Admin F3F' })
    usuarios.push(admin.id)
    cAdmin = await clientFor(admin)
  }, 60_000)

  afterAll(async () => {
    for (const id of centros) await deleteTestCentro(id)
    for (const id of usuarios) await deleteTestUser(id)
  }, 120_000)

  async function nuevoEscenario(): Promise<Escenario> {
    const centro = await createTestCentro('Centro F3F')
    centros.push(centro.id)
    await asignarRol(admin.id, centro.id, 'admin')
    const curso = await createTestCurso(centro.id, 'activo')
    const aula = await createTestAula(centro.id, curso.id)
    return { centroId: centro.id, cursoId: curso.id, aulaId: aula.id }
  }

  /** Niño con familia + matrícula (fecha_alta pasada). Opcionalmente con tutor. */
  async function crearNino(
    e: Escenario,
    opts: { conTutor?: boolean; familiaId?: string; nombre?: string } = {}
  ): Promise<{ ninoId: string; familiaId: string; tutor?: TestUser }> {
    const familiaId = opts.familiaId ?? (await createTestFamilia(e.centroId))
    const { data: nino } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: e.centroId,
        familia_id: familiaId,
        nombre: opts.nombre ?? 'Niño F3F',
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

    let tutor: TestUser | undefined
    if (opts.conTutor) {
      tutor = await createTestUser({ nombre: 'Tutor F3F' })
      usuarios.push(tutor.id)
      await asignarRol(tutor.id, e.centroId, 'tutor_legal')
      await serviceClient
        .from('familia_tutores')
        .insert({ familia_id: familiaId, usuario_id: tutor.id, rol_familia: 'titular' })
      await crearVinculo(ninoId, tutor.id, 'tutor_legal_principal')
    }
    return { ninoId, familiaId, tutor }
  }

  async function ninoArchivado(ninoId: string): Promise<boolean> {
    const { data } = await serviceClient
      .from('ninos')
      .select('deleted_at')
      .eq('id', ninoId)
      .single()
    return data!.deleted_at !== null
  }

  async function familiaInactiva(familiaId: string): Promise<boolean> {
    const { data } = await serviceClient
      .from('familias')
      .select('deleted_at')
      .eq('id', familiaId)
      .single()
    return data!.deleted_at !== null
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

  /** deleted_at del rol tutor_legal del tutor en el centro (para probar "no tocado"). */
  async function rolDeletedAt(usuarioId: string, centroId: string): Promise<string | null> {
    const { data } = await serviceClient
      .from('roles_usuario')
      .select('deleted_at')
      .eq('usuario_id', usuarioId)
      .eq('centro_id', centroId)
      .eq('rol', 'tutor_legal')
      .single()
    return data!.deleted_at
  }

  async function vinculosVivos(ninoId: string): Promise<boolean> {
    const { data } = await serviceClient
      .from('vinculos_familiares')
      .select('deleted_at')
      .eq('nino_id', ninoId)
    return (data ?? []).length > 0 && (data ?? []).every((v) => v.deleted_at === null)
  }

  it('(a) familia activa con hermano: desarchivar no toca familia ni rol', async () => {
    const e = await nuevoEscenario()
    const familiaId = await createTestFamilia(e.centroId)
    const baja = await crearNino(e, { familiaId, conTutor: true, nombre: 'Hermano Baja' })
    // Segundo hijo activo de la MISMA familia (protege a la familia de la revocación).
    const activo = await crearNino(e, { familiaId, nombre: 'Hermano Activo' })
    await crearVinculo(activo.ninoId, baja.tutor!.id, 'tutor_legal_principal')

    // Baja del hermano → familia NO revocada, rol intacto.
    await cAdmin.rpc('baja_nino', { p_nino_id: baja.ninoId, p_motivo: 'traslado' })
    expect(await familiaInactiva(familiaId)).toBe(false)
    expect(await rolesActivos([baja.tutor!.id])).toBe(1)
    const rolAntes = await rolDeletedAt(baja.tutor!.id, e.centroId) // null

    const { data, error } = await cAdmin.rpc('desarchivar_nino', {
      p_nino_id: baja.ninoId,
      p_aula_id: e.aulaId,
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({
      desarchivado: true,
      familia_reactivada: false,
      roles_reactivados: 0,
    })

    expect(await ninoArchivado(baja.ninoId)).toBe(false)
    expect(await vinculosVivos(baja.ninoId)).toBe(true) // vínculo revivido
    // Familia y rol NUNCA tocados (deleted_at del rol sigue igual = null).
    expect(await familiaInactiva(familiaId)).toBe(false)
    expect(await rolesActivos([baja.tutor!.id])).toBe(1)
    expect(await rolDeletedAt(baja.tutor!.id, e.centroId)).toBe(rolAntes)
  })

  it('(b) hijo único: desarchivar reactiva familia + rol + vínculo', async () => {
    const e = await nuevoEscenario()
    const { ninoId, familiaId, tutor } = await crearNino(e, { conTutor: true })

    await cAdmin.rpc('baja_nino', { p_nino_id: ninoId, p_motivo: 'traslado' })
    expect(await familiaInactiva(familiaId)).toBe(true)
    expect(await rolesActivos([tutor!.id])).toBe(0)

    const { data, error } = await cAdmin.rpc('desarchivar_nino', {
      p_nino_id: ninoId,
      p_aula_id: e.aulaId,
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({
      desarchivado: true,
      familia_reactivada: true,
      roles_reactivados: 1,
    })

    expect(await ninoArchivado(ninoId)).toBe(false)
    expect(await familiaInactiva(familiaId)).toBe(false) // familia reactivada
    expect(await rolesActivos([tutor!.id])).toBe(1) // rol revivido
    expect(await vinculosVivos(ninoId)).toBe(true) // vínculo revivido
  })

  it('matrícula nueva del curso activo, estado activa, fecha_alta hoy; la vieja sigue baja', async () => {
    const e = await nuevoEscenario()
    const { ninoId } = await crearNino(e)

    await cAdmin.rpc('baja_nino', { p_nino_id: ninoId, p_motivo: 'x' })
    const { data: rpc } = await cAdmin.rpc('desarchivar_nino', {
      p_nino_id: ninoId,
      p_aula_id: e.aulaId,
    })
    const { data: hoy } = await serviceClient.rpc('hoy_madrid')

    const { data: mats } = await serviceClient
      .from('matriculas')
      .select('id, estado, fecha_alta, fecha_baja, curso_academico_id')
      .eq('nino_id', ninoId)
    expect(mats!.length).toBe(2) // historial preservado: baja + nueva

    const activa = mats!.find((m) => m.estado === 'activa')
    const baja = mats!.find((m) => m.estado === 'baja')
    expect(activa).toBeDefined()
    expect(activa!.fecha_baja).toBeNull()
    expect(activa!.curso_academico_id).toBe(e.cursoId) // curso ACTIVO
    expect(activa!.fecha_alta).toBe(hoy) // fecha_alta = hoy_madrid()
    expect((rpc as { matricula_id: string }).matricula_id).toBe(activa!.id)
    expect(baja).toBeDefined()
    expect(baja!.fecha_baja).not.toBeNull() // la vieja conserva su baja
  })

  it('idempotencia: desarchivar un niño ya activo → ya_activo, 0 cambios', async () => {
    const e = await nuevoEscenario()
    const { ninoId } = await crearNino(e) // nunca archivado

    const r = await cAdmin.rpc('desarchivar_nino', { p_nino_id: ninoId, p_aula_id: e.aulaId })
    expect(r.error).toBeNull()
    expect(r.data).toMatchObject({ ya_activo: true })

    // 0 cambios: sigue habiendo una sola matrícula (no se abrió otra).
    const { data: mats } = await serviceClient.from('matriculas').select('id').eq('nino_id', ninoId)
    expect(mats!.length).toBe(1)
  })

  it('authz: profe/tutor NO; admin SÍ; service_role SÍ', async () => {
    const e = await nuevoEscenario()
    const n1 = await crearNino(e, { conTutor: true })
    await cAdmin.rpc('baja_nino', { p_nino_id: n1.ninoId, p_motivo: 'x' }) // archivado

    const profe = await createTestUser({ nombre: 'Profe F3F' })
    usuarios.push(profe.id)
    await asignarRol(profe.id, e.centroId, 'profe')
    const cProfe = await clientFor(profe)
    const cTutor = await clientFor(n1.tutor!)

    const rProfe = await cProfe.rpc('desarchivar_nino', {
      p_nino_id: n1.ninoId,
      p_aula_id: e.aulaId,
    })
    expect(rProfe.error).not.toBeNull()
    const rTutor = await cTutor.rpc('desarchivar_nino', {
      p_nino_id: n1.ninoId,
      p_aula_id: e.aulaId,
    })
    expect(rTutor.error).not.toBeNull()
    expect(await ninoArchivado(n1.ninoId)).toBe(true) // sigue archivado

    const rAdmin = await cAdmin.rpc('desarchivar_nino', {
      p_nino_id: n1.ninoId,
      p_aula_id: e.aulaId,
    })
    expect(rAdmin.error).toBeNull()
    expect(await ninoArchivado(n1.ninoId)).toBe(false)

    // service_role SÍ (ruta de sistema) sobre otro niño.
    const n2 = await crearNino(e)
    await cAdmin.rpc('baja_nino', { p_nino_id: n2.ninoId, p_motivo: 'x' })
    const rSvc = await serviceClient.rpc('desarchivar_nino', {
      p_nino_id: n2.ninoId,
      p_aula_id: e.aulaId,
    })
    expect(rSvc.error).toBeNull()
    expect(await ninoArchivado(n2.ninoId)).toBe(false)
  })

  it('sin curso activo → error', async () => {
    const e = await nuevoEscenario()
    const { ninoId } = await crearNino(e)
    await cAdmin.rpc('baja_nino', { p_nino_id: ninoId, p_motivo: 'x' })

    // Cerrar el curso activo → el centro se queda sin curso activo.
    await serviceClient.from('cursos_academicos').update({ estado: 'cerrado' }).eq('id', e.cursoId)

    const r = await cAdmin.rpc('desarchivar_nino', { p_nino_id: ninoId, p_aula_id: e.aulaId })
    expect(r.error).not.toBeNull()
    expect(await ninoArchivado(ninoId)).toBe(true) // sigue archivado
  })

  it('aula inválida (no en aulas_curso del curso activo) → error', async () => {
    const e = await nuevoEscenario()
    const { ninoId } = await crearNino(e)
    await cAdmin.rpc('baja_nino', { p_nino_id: ninoId, p_motivo: 'x' })

    const r = await cAdmin.rpc('desarchivar_nino', { p_nino_id: ninoId, p_aula_id: randomUUID() })
    expect(r.error).not.toBeNull()
    expect(await ninoArchivado(ninoId)).toBe(true)
  })

  it('atomicidad: fallo (aula inválida) → NADA cambió', async () => {
    const e = await nuevoEscenario()
    const { ninoId, familiaId, tutor } = await crearNino(e, { conTutor: true })
    await cAdmin.rpc('baja_nino', { p_nino_id: ninoId, p_motivo: 'x' }) // familia archivada + rol revocado

    const r = await cAdmin.rpc('desarchivar_nino', { p_nino_id: ninoId, p_aula_id: randomUUID() })
    expect(r.error).not.toBeNull()

    // Todo intacto: niño archivado, familia archivada, rol revocado, sin matrícula nueva.
    expect(await ninoArchivado(ninoId)).toBe(true)
    expect(await familiaInactiva(familiaId)).toBe(true)
    expect(await rolesActivos([tutor!.id])).toBe(0)
    const { data: mats } = await serviceClient
      .from('matriculas')
      .select('estado')
      .eq('nino_id', ninoId)
    expect(mats!.every((m) => m.estado === 'baja')).toBe(true) // ninguna activa nueva
  })
})
