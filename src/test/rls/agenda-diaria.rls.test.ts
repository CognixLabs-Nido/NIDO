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
 * RLS de agenda diaria (Fase 3).
 *
 * Verifica:
 *  - aislamiento entre centros (admin A no ve B),
 *  - aislamiento entre aulas dentro del mismo centro (profe A2 no ve A1),
 *  - profe del aula puede INSERT/UPDATE en fecha de HOY,
 *  - profe del aula NO puede INSERT/UPDATE en fecha de AYER (fuera de ventana),
 *  - tutor sin `puede_ver_agenda` no lee,
 *  - tutor con `puede_ver_agenda` lee pero no escribe,
 *  - DELETE rechazado a todos los roles (incluido admin) por default-deny.
 */

function madridDateOffset(daysOffset: number): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = fmt.formatToParts(new Date(Date.now() + daysOffset * 24 * 60 * 60 * 1000))
  const y = parts.find((p) => p.type === 'year')!.value
  const m = parts.find((p) => p.type === 'month')!.value
  const d = parts.find((p) => p.type === 'day')!.value
  return `${y}-${m}-${d}`
}

describe('RLS agenda diaria — aislamiento, ventana de edición y permisos', () => {
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
  let agendaAyerA: { id: string }
  let agendaHoyB: { id: string }
  // Ids creados durante los tests para limpiar en afterAll.
  const agendasCreadas: string[] = []

  const hoy = madridDateOffset(0)
  const ayer = madridDateOffset(-1)
  const anteayer = madridDateOffset(-2)

  beforeAll(async () => {
    centroA = await createTestCentro('Centro Agenda A')
    centroB = await createTestCentro('Centro Agenda B')

    cursoA = await createTestCurso(centroA.id)
    cursoB = await createTestCurso(centroB.id)

    aulaA1 = await createTestAula(centroA.id, cursoA.id, 'Aula A1')
    aulaA2 = await createTestAula(centroA.id, cursoA.id, 'Aula A2')
    aulaB1 = await createTestAula(centroB.id, cursoB.id, 'Aula B1')

    ninoA = await createTestNino(centroA.id, 'Niño A')
    ninoB = await createTestNino(centroB.id, 'Niño B')

    await matricular(ninoA.id, aulaA1.id, cursoA.id)
    await matricular(ninoB.id, aulaB1.id, cursoB.id)

    adminA = await createTestUser({ nombre: 'Admin Agenda A' })
    await asignarRol(adminA.id, centroA.id, 'admin')

    profeAulaA1 = await createTestUser({ nombre: 'Profe Aula A1' })
    await asignarRol(profeAulaA1.id, centroA.id, 'profe')
    await asignarProfeAula(profeAulaA1.id, aulaA1.id)

    profeAulaA2 = await createTestUser({ nombre: 'Profe Aula A2' })
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

    // Agendas precargadas con service role (bypass RLS):
    // - agendaAyerA: niñoA, fecha=ayer, observaciones inicial conocida.
    // - agendaHoyB: niñoB, fecha=hoy (centroB) — para test cross-centro.
    const { data: ayerRow, error: ayerErr } = await serviceClient
      .from('agendas_diarias')
      .insert({
        nino_id: ninoA.id,
        fecha: ayer,
        observaciones_generales: 'inicial-ayer',
      })
      .select('id')
      .single()
    if (ayerErr || !ayerRow) throw new Error(`seed agendaAyerA: ${ayerErr?.message}`)
    agendaAyerA = { id: ayerRow.id }

    const { data: hoyBRow, error: hoyBErr } = await serviceClient
      .from('agendas_diarias')
      .insert({
        nino_id: ninoB.id,
        fecha: hoy,
        observaciones_generales: 'centro-b-hoy',
      })
      .select('id')
      .single()
    if (hoyBErr || !hoyBRow) throw new Error(`seed agendaHoyB: ${hoyBErr?.message}`)
    agendaHoyB = { id: hoyBRow.id }
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

    const agendaIds = [agendaAyerA?.id, agendaHoyB?.id, ...agendasCreadas].filter(
      (a): a is string => Boolean(a)
    )
    if (agendaIds.length > 0) {
      await serviceClient.from('agendas_diarias').delete().in('id', agendaIds)
    }

    await serviceClient.from('matriculas').delete().in('nino_id', [ninoA.id, ninoB.id])
    await serviceClient.from('ninos').delete().in('id', [ninoA.id, ninoB.id])
    await serviceClient.from('aulas').delete().in('id', [aulaA1.id, aulaA2.id, aulaB1.id])
    await serviceClient.from('cursos_academicos').delete().in('id', [cursoA.id, cursoB.id])
    await deleteTestCentro(centroA.id)
    await deleteTestCentro(centroB.id)
  }, 90_000)

  it('admin del centro A NO ve agendas del centro B', async () => {
    const client = await clientFor(adminA)
    const { data, error } = await client
      .from('agendas_diarias')
      .select('id, nino_id')
      .eq('nino_id', ninoB.id)
    expect(error).toBeNull()
    expect((data ?? []).length).toBe(0)
  })

  it('profe de OTRA aula del mismo centro NO ve la agenda del niño', async () => {
    const client = await clientFor(profeAulaA2)
    const { data, error } = await client
      .from('agendas_diarias')
      .select('id, nino_id')
      .eq('nino_id', ninoA.id)
    expect(error).toBeNull()
    expect((data ?? []).length).toBe(0)
  })

  it('profe del aula del niño puede INSERT agenda de HOY', async () => {
    const client = await clientFor(profeAulaA1)
    const { data, error } = await client
      .from('agendas_diarias')
      .insert({
        nino_id: ninoA.id,
        fecha: hoy,
        observaciones_generales: 'creada-por-profe-hoy',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    if (data?.id) agendasCreadas.push(data.id)
  })

  it('profe del aula del niño NO puede INSERT agenda fuera de ventana (anteayer)', async () => {
    const client = await clientFor(profeAulaA1)
    const { data, error } = await client
      .from('agendas_diarias')
      .insert({
        nino_id: ninoA.id,
        fecha: anteayer,
        observaciones_generales: 'intento-fuera-de-ventana',
      })
      .select('id')
      .maybeSingle()
    // RLS rechaza: PostgREST devuelve error 42501 / "row violates ...".
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  it('profe del aula NO puede UPDATE en agenda existente con fecha de ayer', async () => {
    const client = await clientFor(profeAulaA1)
    const { error } = await client
      .from('agendas_diarias')
      .update({ observaciones_generales: 'intento-modificar-ayer' })
      .eq('id', agendaAyerA.id)
    expect(error).toBeNull() // PostgREST no devuelve error si 0 filas afectadas.
    // Verificamos con service que la fila no cambió.
    const { data: verify } = await serviceClient
      .from('agendas_diarias')
      .select('observaciones_generales')
      .eq('id', agendaAyerA.id)
      .single()
    expect(verify?.observaciones_generales).toBe('inicial-ayer')
  })

  it('tutor sin puede_ver_agenda NO ve la agenda del niño', async () => {
    const client = await clientFor(tutorSinPermiso)
    const { data, error } = await client
      .from('agendas_diarias')
      .select('id, nino_id')
      .eq('nino_id', ninoA.id)
    expect(error).toBeNull()
    expect((data ?? []).length).toBe(0)
  })

  it('tutor con puede_ver_agenda ve la agenda pero NO puede UPDATE', async () => {
    const client = await clientFor(tutorConPermiso)
    const { data: selectData, error: selectErr } = await client
      .from('agendas_diarias')
      .select('id, nino_id')
      .eq('nino_id', ninoA.id)
    expect(selectErr).toBeNull()
    expect((selectData ?? []).length).toBeGreaterThanOrEqual(1)

    const { error: updateErr } = await client
      .from('agendas_diarias')
      .update({ observaciones_generales: 'tutor-intenta-modificar' })
      .eq('id', agendaAyerA.id)
    expect(updateErr).toBeNull() // sin error porque 0 filas afectadas
    const { data: verify } = await serviceClient
      .from('agendas_diarias')
      .select('observaciones_generales')
      .eq('id', agendaAyerA.id)
      .single()
    expect(verify?.observaciones_generales).toBe('inicial-ayer')
  })

  it('DELETE en agendas_diarias está rechazado a admin por default-deny', async () => {
    const client = await clientFor(adminA)
    const { error } = await client.from('agendas_diarias').delete().eq('id', agendaAyerA.id)
    expect(error).toBeNull() // 0 filas afectadas, no devuelve error.
    const { data: verify } = await serviceClient
      .from('agendas_diarias')
      .select('id')
      .eq('id', agendaAyerA.id)
      .maybeSingle()
    expect(verify?.id).toBe(agendaAyerA.id)
  })
})
