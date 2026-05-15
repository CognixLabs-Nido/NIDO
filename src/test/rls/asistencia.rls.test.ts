import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarProfeAula,
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

/**
 * RLS de `asistencias` (Fase 4).
 *
 * Verifica:
 *  - aislamiento entre centros,
 *  - aislamiento entre aulas dentro del mismo centro,
 *  - ventana de edición = mismo día calendario Madrid (ADR-0013/0016) —
 *    profe puede INSERT con fecha=hoy, NO con fecha=ayer/anteayer,
 *  - tutor sin `puede_ver_agenda` no lee,
 *  - tutor con `puede_ver_agenda` lee pero no escribe,
 *  - DELETE rechazado a todos (default DENY).
 */

function madridDateOffset(daysOffset: number): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = fmt.formatToParts(new Date(Date.now() + daysOffset * 24 * 60 * 60 * 1000))
  return [
    parts.find((p) => p.type === 'year')!.value,
    parts.find((p) => p.type === 'month')!.value,
    parts.find((p) => p.type === 'day')!.value,
  ].join('-')
}

describe('RLS asistencias — aislamiento, ventana y permisos', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let cursoA: { id: string }
  let cursoB: { id: string }
  let aulaA1: { id: string }
  let aulaA2: { id: string }
  let aulaB1: { id: string }
  let ninoA: { id: string }
  let ninoB: { id: string }
  let adminA: TestUser
  let profeAulaA1: TestUser
  let profeAulaA2: TestUser
  let tutorConPermiso: TestUser
  let tutorSinPermiso: TestUser
  let asistenciaAyerA: { id: string }
  const asistenciasCreadas: string[] = []

  const hoy = madridDateOffset(0)
  const ayer = madridDateOffset(-1)
  const anteayer = madridDateOffset(-2)

  beforeAll(async () => {
    centroA = await createTestCentro('Centro Asistencia A')
    centroB = await createTestCentro('Centro Asistencia B')

    cursoA = await createTestCurso(centroA.id)
    cursoB = await createTestCurso(centroB.id)

    aulaA1 = await createTestAula(centroA.id, cursoA.id, 'Aula A1')
    aulaA2 = await createTestAula(centroA.id, cursoA.id, 'Aula A2')
    aulaB1 = await createTestAula(centroB.id, cursoB.id, 'Aula B1')

    ninoA = await createTestNino(centroA.id, 'Niño Asist A')
    ninoB = await createTestNino(centroB.id, 'Niño Asist B')

    await matricular(ninoA.id, aulaA1.id, cursoA.id)
    await matricular(ninoB.id, aulaB1.id, cursoB.id)

    adminA = await createTestUser({ nombre: 'Admin Asist A' })
    await asignarRol(adminA.id, centroA.id, 'admin')

    profeAulaA1 = await createTestUser({ nombre: 'Profe Asist A1' })
    await asignarRol(profeAulaA1.id, centroA.id, 'profe')
    await asignarProfeAula(profeAulaA1.id, aulaA1.id)

    profeAulaA2 = await createTestUser({ nombre: 'Profe Asist A2' })
    await asignarRol(profeAulaA2.id, centroA.id, 'profe')
    await asignarProfeAula(profeAulaA2.id, aulaA2.id)

    tutorConPermiso = await createTestUser({ nombre: 'Tutor con permiso agenda' })
    await asignarRol(tutorConPermiso.id, centroA.id, 'tutor_legal')
    await crearVinculo(ninoA.id, tutorConPermiso.id, 'tutor_legal_principal', {
      puede_ver_agenda: true,
    })

    tutorSinPermiso = await createTestUser({ nombre: 'Tutor sin permiso agenda' })
    await asignarRol(tutorSinPermiso.id, centroA.id, 'tutor_legal')
    await crearVinculo(ninoA.id, tutorSinPermiso.id, 'tutor_legal_secundario', {
      puede_ver_agenda: false,
    })

    // Pre-seed con service role (bypass RLS): una asistencia de ayer para
    // verificar que UPDATE está bloqueado (fuera de ventana).
    const { data, error } = await serviceClient
      .from('asistencias')
      .insert({ nino_id: ninoA.id, fecha: ayer, estado: 'presente', hora_llegada: '09:00' })
      .select('id')
      .single()
    if (error || !data) throw new Error(`seed asistenciaAyerA: ${error?.message}`)
    asistenciaAyerA = { id: data.id }
  }, 120_000)

  afterAll(async () => {
    const usuarios = [
      adminA?.id,
      profeAulaA1?.id,
      profeAulaA2?.id,
      tutorConPermiso?.id,
      tutorSinPermiso?.id,
    ].filter((u): u is string => Boolean(u))

    await serviceClient.from('vinculos_familiares').delete().in('usuario_id', usuarios)
    await serviceClient.from('profes_aulas').delete().in('profe_id', usuarios)
    await serviceClient.from('roles_usuario').delete().in('usuario_id', usuarios)
    for (const u of usuarios) await deleteTestUser(u)

    const ids = [asistenciaAyerA?.id, ...asistenciasCreadas].filter((a): a is string => Boolean(a))
    if (ids.length > 0) {
      await serviceClient.from('asistencias').delete().in('id', ids)
    }

    await serviceClient.from('matriculas').delete().in('nino_id', [ninoA.id, ninoB.id])
    await serviceClient.from('ninos').delete().in('id', [ninoA.id, ninoB.id])
    await serviceClient.from('aulas').delete().in('id', [aulaA1.id, aulaA2.id, aulaB1.id])
    await serviceClient.from('cursos_academicos').delete().in('id', [cursoA.id, cursoB.id])
    await deleteTestCentro(centroA.id)
    await deleteTestCentro(centroB.id)
  }, 90_000)

  it('admin del centro A NO ve asistencias del centro B', async () => {
    const client = await clientFor(adminA)
    const { data, error } = await client
      .from('asistencias')
      .select('id, nino_id')
      .eq('nino_id', ninoB.id)
    expect(error).toBeNull()
    expect((data ?? []).length).toBe(0)
  })

  it('profe de OTRA aula del mismo centro NO ve la asistencia del niño', async () => {
    const client = await clientFor(profeAulaA2)
    const { data, error } = await client
      .from('asistencias')
      .select('id, nino_id')
      .eq('nino_id', ninoA.id)
    expect(error).toBeNull()
    expect((data ?? []).length).toBe(0)
  })

  it('profe del aula puede INSERT asistencia con fecha=HOY', async () => {
    const client = await clientFor(profeAulaA1)
    const { data, error } = await client
      .from('asistencias')
      .insert({
        nino_id: ninoA.id,
        fecha: hoy,
        estado: 'presente',
        hora_llegada: '09:10',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    if (data?.id) asistenciasCreadas.push(data.id)
  })

  it('profe del aula NO puede INSERT asistencia con fecha=ANTEAYER (fuera de ventana)', async () => {
    const client = await clientFor(profeAulaA1)
    const { data, error } = await client
      .from('asistencias')
      .insert({
        nino_id: ninoA.id,
        fecha: anteayer,
        estado: 'ausente',
      })
      .select('id')
      .maybeSingle()
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  it('profe NO puede UPDATE asistencia con fecha=AYER', async () => {
    const client = await clientFor(profeAulaA1)
    const { error } = await client
      .from('asistencias')
      .update({ observaciones: 'intento-modificar-ayer' })
      .eq('id', asistenciaAyerA.id)
    expect(error).toBeNull() // PostgREST no error si 0 filas afectadas
    const { data: verify } = await serviceClient
      .from('asistencias')
      .select('observaciones')
      .eq('id', asistenciaAyerA.id)
      .single()
    expect(verify?.observaciones).toBeNull()
  })

  it('tutor sin puede_ver_agenda NO ve asistencias del niño', async () => {
    const client = await clientFor(tutorSinPermiso)
    const { data, error } = await client
      .from('asistencias')
      .select('id, nino_id')
      .eq('nino_id', ninoA.id)
    expect(error).toBeNull()
    expect((data ?? []).length).toBe(0)
  })

  it('tutor con puede_ver_agenda ve asistencias pero NO puede INSERT', async () => {
    const client = await clientFor(tutorConPermiso)
    const { data: selectData, error: selectErr } = await client
      .from('asistencias')
      .select('id')
      .eq('nino_id', ninoA.id)
    expect(selectErr).toBeNull()
    expect((selectData ?? []).length).toBeGreaterThanOrEqual(1)

    const { data: insertData, error: insertErr } = await client
      .from('asistencias')
      .insert({
        nino_id: ninoA.id,
        fecha: hoy,
        estado: 'ausente',
      })
      .select('id')
      .maybeSingle()
    expect(insertErr).not.toBeNull()
    expect(insertData).toBeNull()
  })

  it('DELETE en asistencias está bloqueado a admin por default-deny', async () => {
    const client = await clientFor(adminA)
    const { error } = await client.from('asistencias').delete().eq('id', asistenciaAyerA.id)
    expect(error).toBeNull() // 0 filas afectadas
    const { data: verify } = await serviceClient
      .from('asistencias')
      .select('id')
      .eq('id', asistenciaAyerA.id)
      .maybeSingle()
    expect(verify?.id).toBe(asistenciaAyerA.id)
  })
})
