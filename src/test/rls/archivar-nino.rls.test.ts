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
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * F-3-C-1 — RPC `archivar_nino` (primitivo transaccional de archivado).
 *
 *  1. happy path: cierra la matrícula (baja + fecha + motivo), soft-borra los vínculos,
 *     archiva el niño (deleted_at); devuelve el resumen.
 *  2. multicurso: un niño con 2 matrículas activas (2 cursos) → AMBAS cerradas.
 *  3. idempotencia: 2.ª llamada → ya_archivado:true, 0 cambios, sin error.
 *  4. authz: profe y tutor denegados; admin de otro centro denegado; service_role OK.
 *     (admin del centro OK lo cubre el happy path.)
 *  5. atomicidad: si un write falla (fecha_baja < fecha_alta viola el CHECK) → rollback
 *     total: niño, matrícula y vínculos quedan intactos.
 *  6. vista del tutor: tras archivar, el vínculo soft-borrado desaparece de su consulta.
 *  7. NO toca: roles_usuario del tutor, familias.deleted_at, ni la matrícula de otro niño.
 *
 * Gate: F3C1_MIGRATION_APPLIED=1 (requiere la migración 20260717120000 aplicada).
 */

const APPLIED = process.env.F3C1_MIGRATION_APPLIED === '1'
// Los fixtures matriculan con fecha_alta='2026-09-01'; la baja debe ser >= (CHECK).
const FECHA_BAJA = '2027-06-30'

describe.skipIf(!APPLIED)('F-3-C-1 — archivar_nino (RPC)', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let cursoA: { id: string }
  let cursoA2: { id: string }
  let aulaA: { id: string }
  let aulaA2: { id: string }
  let adminA: TestUser
  let adminB: TestUser
  let profeA: TestUser
  let tutorA: TestUser
  let autorizadoA: TestUser
  let cAdminA: SupabaseClient<Database>
  let cAdminB: SupabaseClient<Database>
  let cProfeA: SupabaseClient<Database>
  let cTutorA: SupabaseClient<Database>

  beforeAll(async () => {
    centroA = await createTestCentro('Centro F3C1 A')
    centroB = await createTestCentro('Centro F3C1 B')
    cursoA = await createTestCurso(centroA.id, 'activo')
    cursoA2 = await createTestCurso(centroA.id, 'planificado') // 2.º curso → 2.ª activa
    aulaA = await createTestAula(centroA.id, cursoA.id, 'Aula A')
    aulaA2 = await createTestAula(centroA.id, cursoA2.id, 'Aula A2')

    adminA = await createTestUser({ nombre: 'Admin F3C1 A' })
    adminB = await createTestUser({ nombre: 'Admin F3C1 B' })
    profeA = await createTestUser({ nombre: 'Profe F3C1 A' })
    tutorA = await createTestUser({ nombre: 'Tutor F3C1 A' })
    autorizadoA = await createTestUser({ nombre: 'Autorizado F3C1 A' })
    await asignarRol(adminA.id, centroA.id, 'admin')
    await asignarRol(adminB.id, centroB.id, 'admin')
    await asignarRol(profeA.id, centroA.id, 'profe')
    await asignarRol(tutorA.id, centroA.id, 'tutor_legal')

    cAdminA = await clientFor(adminA)
    cAdminB = await clientFor(adminB)
    cProfeA = await clientFor(profeA)
    cTutorA = await clientFor(tutorA)
  }, 60_000)

  afterAll(async () => {
    await deleteTestCentro(centroA.id)
    await deleteTestCentro(centroB.id)
    await deleteTestUser(adminA.id)
    await deleteTestUser(adminB.id)
    await deleteTestUser(profeA.id)
    await deleteTestUser(tutorA.id)
    await deleteTestUser(autorizadoA.id)
  }, 60_000)

  /** Crea un niño en centroA con una matrícula activa en cursoA y un tutor principal. */
  async function ninoConMatriculaYTutor(
    nombre?: string
  ): Promise<{ id: string; matriculaId: string }> {
    const nino = await createTestNino(centroA.id, nombre)
    const matriculaId = await matricular(nino.id, aulaA.id, cursoA.id)
    await crearVinculo(nino.id, tutorA.id, 'tutor_legal_principal', { puede_ver_agenda: true })
    return { id: nino.id, matriculaId }
  }

  it('happy path: cierra matrícula, soft-borra vínculos y archiva el niño', async () => {
    const nino = await createTestNino(centroA.id, 'Archivo Happy')
    const matriculaId = await matricular(nino.id, aulaA.id, cursoA.id)
    await crearVinculo(nino.id, tutorA.id, 'tutor_legal_principal', { puede_ver_agenda: true })
    await crearVinculo(nino.id, autorizadoA.id, 'autorizado', {})

    const { data, error } = await cAdminA.rpc('archivar_nino', {
      p_nino_id: nino.id,
      p_motivo: 'fin de etapa',
      p_fecha_baja: FECHA_BAJA,
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({
      nino_id: nino.id,
      ya_archivado: false,
      matriculas_cerradas: 1,
      vinculos_borrados: 2,
    })

    const { data: n } = await serviceClient
      .from('ninos')
      .select('deleted_at')
      .eq('id', nino.id)
      .single()
    expect(n!.deleted_at).not.toBeNull()

    const { data: m } = await serviceClient
      .from('matriculas')
      .select('estado, fecha_baja, motivo_baja')
      .eq('id', matriculaId)
      .single()
    expect(m!.estado).toBe('baja')
    expect(m!.fecha_baja).toBe(FECHA_BAJA)
    expect(m!.motivo_baja).toBe('fin de etapa')

    const { data: vin } = await serviceClient
      .from('vinculos_familiares')
      .select('deleted_at')
      .eq('nino_id', nino.id)
    expect(vin ?? []).toHaveLength(2)
    expect((vin ?? []).every((v) => v.deleted_at !== null)).toBe(true)
  })

  it('multicurso: 2 matrículas activas (2 cursos) → AMBAS cerradas', async () => {
    const nino = await createTestNino(centroA.id, 'Archivo Multicurso')
    await matricular(nino.id, aulaA.id, cursoA.id) // curso activo
    await matricular(nino.id, aulaA2.id, cursoA2.id) // 2.º curso → 2.ª activa
    await crearVinculo(nino.id, tutorA.id, 'tutor_legal_principal')

    const { data, error } = await cAdminA.rpc('archivar_nino', {
      p_nino_id: nino.id,
      p_fecha_baja: FECHA_BAJA,
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ matriculas_cerradas: 2 })

    const { data: mats } = await serviceClient
      .from('matriculas')
      .select('estado, fecha_baja')
      .eq('nino_id', nino.id)
    expect(mats ?? []).toHaveLength(2)
    expect((mats ?? []).every((m) => m.estado === 'baja' && m.fecha_baja === FECHA_BAJA)).toBe(true)
  })

  it('idempotencia: 2.ª llamada → ya_archivado:true, 0 cambios, sin error', async () => {
    const nino = await ninoConMatriculaYTutor('Archivo Idempotente')

    const first = await cAdminA.rpc('archivar_nino', {
      p_nino_id: nino.id,
      p_fecha_baja: FECHA_BAJA,
    })
    expect(first.error).toBeNull()
    expect(first.data).toMatchObject({ ya_archivado: false, matriculas_cerradas: 1 })

    const second = await cAdminA.rpc('archivar_nino', {
      p_nino_id: nino.id,
      p_fecha_baja: FECHA_BAJA,
    })
    expect(second.error).toBeNull()
    expect(second.data).toMatchObject({
      ya_archivado: true,
      matriculas_cerradas: 0,
      vinculos_borrados: 0,
    })
  })

  it('authz: profe NO; tutor NO; admin de otro centro NO', async () => {
    const nino = await ninoConMatriculaYTutor('Archivo Authz')

    const profe = await cProfeA.rpc('archivar_nino', {
      p_nino_id: nino.id,
      p_fecha_baja: FECHA_BAJA,
    })
    expect(profe.error).not.toBeNull()
    const tutor = await cTutorA.rpc('archivar_nino', {
      p_nino_id: nino.id,
      p_fecha_baja: FECHA_BAJA,
    })
    expect(tutor.error).not.toBeNull()
    const otroCentro = await cAdminB.rpc('archivar_nino', {
      p_nino_id: nino.id,
      p_fecha_baja: FECHA_BAJA,
    })
    expect(otroCentro.error).not.toBeNull()

    // Ninguno lo archivó.
    const { data: n } = await serviceClient
      .from('ninos')
      .select('deleted_at')
      .eq('id', nino.id)
      .single()
    expect(n!.deleted_at).toBeNull()
  })

  it('authz: service_role SÍ (ruta del cierre de curso)', async () => {
    const nino = await ninoConMatriculaYTutor('Archivo Service')
    const { data, error } = await serviceClient.rpc('archivar_nino', {
      p_nino_id: nino.id,
      p_fecha_baja: FECHA_BAJA,
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ ya_archivado: false, matriculas_cerradas: 1 })
  })

  it('atomicidad: un write que falla (fecha_baja < fecha_alta) → rollback total', async () => {
    const nino = await ninoConMatriculaYTutor('Archivo Rollback')

    // fecha_alta de los fixtures = 2026-09-01; una baja anterior viola el CHECK de matriculas.
    const { error } = await cAdminA.rpc('archivar_nino', {
      p_nino_id: nino.id,
      p_fecha_baja: '2020-01-01',
    })
    expect(error).not.toBeNull()

    // Nada cambió: niño, matrícula y vínculo intactos.
    const { data: n } = await serviceClient
      .from('ninos')
      .select('deleted_at')
      .eq('id', nino.id)
      .single()
    expect(n!.deleted_at).toBeNull()
    const { data: m } = await serviceClient
      .from('matriculas')
      .select('estado, fecha_baja')
      .eq('id', nino.matriculaId)
      .single()
    expect(m!.estado).toBe('activa')
    expect(m!.fecha_baja).toBeNull()
    const { data: v } = await serviceClient
      .from('vinculos_familiares')
      .select('deleted_at')
      .eq('nino_id', nino.id)
    expect((v ?? []).every((row) => row.deleted_at === null)).toBe(true)
  })

  it('vista del tutor: tras archivar, el vínculo soft-borrado deja de verse', async () => {
    const nino = await ninoConMatriculaYTutor('Archivo Oculto')

    const antes = await cTutorA
      .from('vinculos_familiares')
      .select('nino_id')
      .eq('usuario_id', tutorA.id)
      .eq('nino_id', nino.id)
      .is('deleted_at', null)
    expect(antes.data ?? []).toHaveLength(1)

    await cAdminA.rpc('archivar_nino', { p_nino_id: nino.id, p_fecha_baja: FECHA_BAJA })

    const despues = await cTutorA
      .from('vinculos_familiares')
      .select('nino_id')
      .eq('usuario_id', tutorA.id)
      .eq('nino_id', nino.id)
      .is('deleted_at', null)
    expect(despues.data ?? []).toHaveLength(0)
  })

  it('NO toca: roles_usuario del tutor, familias.deleted_at, ni la matrícula de otro niño', async () => {
    const nino = await ninoConMatriculaYTutor('Archivo NoToca')
    const otro = await createTestNino(centroA.id, 'Otro Niño')
    const otroMat = await matricular(otro.id, aulaA.id, cursoA.id)

    await cAdminA.rpc('archivar_nino', { p_nino_id: nino.id, p_fecha_baja: FECHA_BAJA })

    // roles_usuario del tutor: intacto (mantiene acceso — eso es F-3-C-3).
    const { data: rol } = await serviceClient
      .from('roles_usuario')
      .select('id')
      .eq('usuario_id', tutorA.id)
      .is('deleted_at', null)
    expect((rol ?? []).length).toBeGreaterThan(0)

    // familias del niño archivado: NO soft-borrada (eso es F-3-C-3).
    const { data: n } = await serviceClient
      .from('ninos')
      .select('familia_id')
      .eq('id', nino.id)
      .single()
    const { data: fam } = await serviceClient
      .from('familias')
      .select('deleted_at')
      .eq('id', n!.familia_id)
      .single()
    expect(fam!.deleted_at).toBeNull()

    // Otro niño: matrícula y ficha intactas.
    const { data: om } = await serviceClient
      .from('matriculas')
      .select('estado, fecha_baja')
      .eq('id', otroMat)
      .single()
    expect(om!.estado).toBe('activa')
    expect(om!.fecha_baja).toBeNull()
    const { data: on } = await serviceClient
      .from('ninos')
      .select('deleted_at')
      .eq('id', otro.id)
      .single()
    expect(on!.deleted_at).toBeNull()
  })
})
