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
 * RLS de `ausencias` (Fase 4).
 *
 * Cubre el permiso JSONB nuevo `puede_reportar_ausencias`:
 *  - tutor con permiso puede INSERT con fecha_inicio >= hoy,
 *  - tutor con permiso NO puede INSERT con fecha_inicio = ayer,
 *  - tutor con `puede_ver_agenda=true` pero `puede_reportar_ausencias=false`
 *    (caso "autorizado") VE ausencias pero NO puede INSERT,
 *  - profe puede INSERT (registro retrospectivo),
 *  - profe puede UPDATE ausencias propias (reportada_por = self) pero NO
 *    UPDATE ausencias de la familia,
 *  - aislamiento entre centros,
 *  - DELETE rechazado a todos.
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

describe('RLS ausencias — permiso puede_reportar_ausencias y profe propia', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let cursoA: { id: string }
  let cursoB: { id: string }
  let aulaA: { id: string }
  let aulaB: { id: string }
  let ninoA: { id: string }
  let ninoB: { id: string }
  let adminA: TestUser
  let profeAulaA: TestUser
  let tutorConPermiso: TestUser
  let autorizadoSinReportar: TestUser
  let tutorSinNada: TestUser
  let ausenciaCentroB: { id: string }
  let ausenciaDeProfe: { id: string }
  let ausenciaDeFamilia: { id: string }
  const ausenciasCreadas: string[] = []

  const hoy = madridDateOffset(0)
  const ayer = madridDateOffset(-1)
  const manana = madridDateOffset(1)

  beforeAll(async () => {
    centroA = await createTestCentro('Centro Ausencia A')
    centroB = await createTestCentro('Centro Ausencia B')

    cursoA = await createTestCurso(centroA.id)
    cursoB = await createTestCurso(centroB.id)

    aulaA = await createTestAula(centroA.id, cursoA.id, 'Aula Ausen A')
    aulaB = await createTestAula(centroB.id, cursoB.id, 'Aula Ausen B')

    ninoA = await createTestNino(centroA.id, 'Niño Ausen A')
    ninoB = await createTestNino(centroB.id, 'Niño Ausen B')

    await matricular(ninoA.id, aulaA.id, cursoA.id)
    await matricular(ninoB.id, aulaB.id, cursoB.id)

    adminA = await createTestUser({ nombre: 'Admin Ausen A' })
    await asignarRol(adminA.id, centroA.id, 'admin')

    profeAulaA = await createTestUser({ nombre: 'Profe Ausen A' })
    await asignarRol(profeAulaA.id, centroA.id, 'profe')
    await asignarProfeAula(profeAulaA.id, aulaA.id)

    tutorConPermiso = await createTestUser({ nombre: 'Tutor con reportar' })
    await asignarRol(tutorConPermiso.id, centroA.id, 'tutor_legal')
    await crearVinculo(ninoA.id, tutorConPermiso.id, 'tutor_legal_principal', {
      puede_ver_agenda: true,
      puede_reportar_ausencias: true,
    })

    autorizadoSinReportar = await createTestUser({ nombre: 'Autorizado sin reportar' })
    await asignarRol(autorizadoSinReportar.id, centroA.id, 'autorizado')
    await crearVinculo(ninoA.id, autorizadoSinReportar.id, 'autorizado', {
      puede_ver_agenda: true,
      puede_reportar_ausencias: false,
    })

    tutorSinNada = await createTestUser({ nombre: 'Tutor sin nada' })
    await asignarRol(tutorSinNada.id, centroA.id, 'tutor_legal')
    await crearVinculo(ninoA.id, tutorSinNada.id, 'tutor_legal_secundario', {
      puede_ver_agenda: false,
      puede_reportar_ausencias: false,
    })

    // Seeds via service role.
    const seedB = await serviceClient
      .from('ausencias')
      .insert({
        nino_id: ninoB.id,
        fecha_inicio: hoy,
        fecha_fin: hoy,
        motivo: 'enfermedad',
      })
      .select('id')
      .single()
    if (seedB.error || !seedB.data) throw new Error(`seed ausenciaCentroB: ${seedB.error?.message}`)
    ausenciaCentroB = { id: seedB.data.id }

    // Una ausencia "creada por la profe" (reportada_por = profe). Service
    // inserta directamente con reportada_por seteado.
    const seedProfe = await serviceClient
      .from('ausencias')
      .insert({
        nino_id: ninoA.id,
        fecha_inicio: hoy,
        fecha_fin: hoy,
        motivo: 'enfermedad',
        reportada_por: profeAulaA.id,
        descripcion: 'reportada por profe',
      })
      .select('id')
      .single()
    if (seedProfe.error || !seedProfe.data) {
      throw new Error(`seed ausenciaDeProfe: ${seedProfe.error?.message}`)
    }
    ausenciaDeProfe = { id: seedProfe.data.id }

    // Una ausencia "creada por la familia" (reportada_por = tutor).
    const seedFam = await serviceClient
      .from('ausencias')
      .insert({
        nino_id: ninoA.id,
        fecha_inicio: manana,
        fecha_fin: manana,
        motivo: 'cita_medica',
        reportada_por: tutorConPermiso.id,
        descripcion: 'cita médica',
      })
      .select('id')
      .single()
    if (seedFam.error || !seedFam.data) {
      throw new Error(`seed ausenciaDeFamilia: ${seedFam.error?.message}`)
    }
    ausenciaDeFamilia = { id: seedFam.data.id }
  }, 120_000)

  afterAll(async () => {
    const usuarios = [
      adminA?.id,
      profeAulaA?.id,
      tutorConPermiso?.id,
      autorizadoSinReportar?.id,
      tutorSinNada?.id,
    ].filter((u): u is string => Boolean(u))

    await serviceClient.from('vinculos_familiares').delete().in('usuario_id', usuarios)
    await serviceClient.from('profes_aulas').delete().in('profe_id', usuarios)
    await serviceClient.from('roles_usuario').delete().in('usuario_id', usuarios)
    for (const u of usuarios) await deleteTestUser(u)

    const ids = [
      ausenciaCentroB?.id,
      ausenciaDeProfe?.id,
      ausenciaDeFamilia?.id,
      ...ausenciasCreadas,
    ].filter((a): a is string => Boolean(a))
    if (ids.length > 0) {
      await serviceClient.from('ausencias').delete().in('id', ids)
    }

    await serviceClient.from('matriculas').delete().in('nino_id', [ninoA.id, ninoB.id])
    await serviceClient.from('ninos').delete().in('id', [ninoA.id, ninoB.id])
    await serviceClient.from('aulas').delete().in('id', [aulaA.id, aulaB.id])
    await serviceClient.from('cursos_academicos').delete().in('id', [cursoA.id, cursoB.id])
    await deleteTestCentro(centroA.id)
    await deleteTestCentro(centroB.id)
  }, 90_000)

  it('admin centro A NO ve ausencias del centro B', async () => {
    const client = await clientFor(adminA)
    const { data, error } = await client
      .from('ausencias')
      .select('id, nino_id')
      .eq('nino_id', ninoB.id)
    expect(error).toBeNull()
    expect((data ?? []).length).toBe(0)
  })

  it('tutor con puede_reportar_ausencias puede INSERT ausencia con fecha_inicio = HOY', async () => {
    const client = await clientFor(tutorConPermiso)
    const { data, error } = await client
      .from('ausencias')
      .insert({
        nino_id: ninoA.id,
        fecha_inicio: hoy,
        fecha_fin: hoy,
        motivo: 'familiar',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    if (data?.id) ausenciasCreadas.push(data.id)
  })

  it('tutor con puede_reportar_ausencias NO puede INSERT con fecha_inicio = AYER', async () => {
    const client = await clientFor(tutorConPermiso)
    const { data, error } = await client
      .from('ausencias')
      .insert({
        nino_id: ninoA.id,
        fecha_inicio: ayer,
        fecha_fin: ayer,
        motivo: 'enfermedad',
      })
      .select('id')
      .maybeSingle()
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  it('autorizado con puede_ver_agenda pero sin puede_reportar_ausencias VE pero NO inserta', async () => {
    const client = await clientFor(autorizadoSinReportar)
    const { data: selectData, error: selectErr } = await client
      .from('ausencias')
      .select('id')
      .eq('nino_id', ninoA.id)
    expect(selectErr).toBeNull()
    expect((selectData ?? []).length).toBeGreaterThanOrEqual(1)

    const { data: insertData, error: insertErr } = await client
      .from('ausencias')
      .insert({
        nino_id: ninoA.id,
        fecha_inicio: manana,
        fecha_fin: manana,
        motivo: 'familiar',
      })
      .select('id')
      .maybeSingle()
    expect(insertErr).not.toBeNull()
    expect(insertData).toBeNull()
  })

  it('tutor sin permisos no ve ni inserta', async () => {
    const client = await clientFor(tutorSinNada)
    const { data: selectData } = await client.from('ausencias').select('id').eq('nino_id', ninoA.id)
    expect((selectData ?? []).length).toBe(0)

    const { data: insertData, error: insertErr } = await client
      .from('ausencias')
      .insert({
        nino_id: ninoA.id,
        fecha_inicio: manana,
        fecha_fin: manana,
        motivo: 'familiar',
      })
      .select('id')
      .maybeSingle()
    expect(insertErr).not.toBeNull()
    expect(insertData).toBeNull()
  })

  it('profe puede INSERT ausencia (registro retrospectivo)', async () => {
    const client = await clientFor(profeAulaA)
    const { data, error } = await client
      .from('ausencias')
      .insert({
        nino_id: ninoA.id,
        fecha_inicio: hoy,
        fecha_fin: hoy,
        motivo: 'enfermedad',
        descripcion: 'avisaron por teléfono',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    if (data?.id) ausenciasCreadas.push(data.id)
  })

  it('profe puede UPDATE ausencia propia (reportada_por = self)', async () => {
    const client = await clientFor(profeAulaA)
    const { error } = await client
      .from('ausencias')
      .update({ descripcion: '[cancelada] reportada por profe' })
      .eq('id', ausenciaDeProfe.id)
    expect(error).toBeNull()
    const { data: verify } = await serviceClient
      .from('ausencias')
      .select('descripcion')
      .eq('id', ausenciaDeProfe.id)
      .single()
    expect(verify?.descripcion?.startsWith('[cancelada] ')).toBe(true)
  })

  it('profe NO puede UPDATE ausencia de la familia (reportada_por != self)', async () => {
    const client = await clientFor(profeAulaA)
    const { error } = await client
      .from('ausencias')
      .update({ descripcion: '[cancelada] cita médica' })
      .eq('id', ausenciaDeFamilia.id)
    expect(error).toBeNull() // 0 filas afectadas
    const { data: verify } = await serviceClient
      .from('ausencias')
      .select('descripcion')
      .eq('id', ausenciaDeFamilia.id)
      .single()
    expect(verify?.descripcion).toBe('cita médica')
  })

  it('DELETE en ausencias bloqueado a admin (default DENY)', async () => {
    const client = await clientFor(adminA)
    const { error } = await client.from('ausencias').delete().eq('id', ausenciaDeFamilia.id)
    expect(error).toBeNull()
    const { data: verify } = await serviceClient
      .from('ausencias')
      .select('id')
      .eq('id', ausenciaDeFamilia.id)
      .maybeSingle()
    expect(verify?.id).toBe(ausenciaDeFamilia.id)
  })
})
