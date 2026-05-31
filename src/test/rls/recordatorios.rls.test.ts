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
 * RLS de `recordatorios` (F6-A). Gated por `RECORDATORIOS_MIGRATION_APPLIED=1`:
 * la migración `20260531120000_phase6_reminders.sql` se aplica manualmente vía
 * Supabase SQL Editor (CLI con bug SIGILL en Penguin). Hasta entonces estos
 * tests se omiten para no romper la suite. Mismo patrón que `F5B34_MIGRATION_APPLIED`.
 *
 * Cubre: visibilidad/escritura por destino y rol, idempotencia al completar,
 * DELETE denegado, y el test explícito de "INSERT…RETURNING" que confirma que
 * el gotcha MVCC NO aplica (la SELECT policy no re-lee `recordatorios`).
 */
const MIGRATION_APPLIED = process.env.RECORDATORIOS_MIGRATION_APPLIED === '1'

describe.skipIf(!MIGRATION_APPLIED)('RLS recordatorios — F6-A', () => {
  let centro: { id: string }
  let centroB: { id: string }
  let admin: TestUser
  let profe: TestUser
  let tutor: TestUser // tutor del niño, con puede_recibir_mensajes
  let autorizado: TestUser // vínculo sin flag → fuera del canal
  let tutorOtro: TestUser // tutor de otro niño/centro → aislamiento
  let nino: { id: string }
  const creados: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro Recordatorios')
    centroB = await createTestCentro('Centro Recordatorios B')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id, 'Reminder Test')
    await matricular(nino.id, aula.id, curso.id)

    admin = await createTestUser({ nombre: 'Admin Rec' })
    profe = await createTestUser({ nombre: 'Profe Rec' })
    tutor = await createTestUser({ nombre: 'Tutor Rec' })
    autorizado = await createTestUser({ nombre: 'Autorizado Rec' })
    tutorOtro = await createTestUser({ nombre: 'Tutor Otro' })

    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    await asignarRol(autorizado.id, centro.id, 'autorizado')
    await asignarRol(tutorOtro.id, centroB.id, 'tutor_legal')

    await asignarProfeAula(profe.id, aula.id)
    await crearVinculo(nino.id, tutor.id, 'tutor_legal_principal', { puede_recibir_mensajes: true })
    await crearVinculo(nino.id, autorizado.id, 'autorizado', { puede_recibir_mensajes: false })
  }, 120_000)

  afterAll(async () => {
    if (creados.length > 0) {
      await serviceClient.from('recordatorios').delete().in('id', creados)
    }
    for (const u of [admin, profe, tutor, autorizado, tutorOtro]) {
      if (u?.id) await deleteTestUser(u.id)
    }
    // El cascade de centros limpia niño, matrícula, aula, curso, vínculos.
    if (centro?.id) await deleteTestCentro(centro.id)
    if (centroB?.id) await deleteTestCentro(centroB.id)
  }, 120_000)

  // --- familia: centro → familia ------------------------------------------
  it('familia: admin INSERT con .select() devuelve la fila (gotcha MVCC NO aplica)', async () => {
    const c = await clientFor(admin)
    const { data, error } = await c
      .from('recordatorios')
      .insert({
        centro_id: centro.id,
        destinatario: 'familia',
        nino_id: nino.id,
        creado_por: admin.id,
        titulo: 'traer cartilla de vacunas',
      })
      .select('id, titulo')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    if (data?.id) creados.push(data.id)
  })

  it('familia: tutor con flag lo VE; autorizado sin flag NO', async () => {
    const cTutor = await clientFor(tutor)
    const visto = await cTutor.from('recordatorios').select('id').eq('destinatario', 'familia')
    expect(visto.error).toBeNull()
    expect((visto.data ?? []).length).toBeGreaterThan(0)

    const cAut = await clientFor(autorizado)
    const noVisto = await cAut.from('recordatorios').select('id').eq('destinatario', 'familia')
    expect((noVisto.data ?? []).length).toBe(0)
  })

  it('familia: tutor de otro centro NO ve nada', async () => {
    const c = await clientFor(tutorOtro)
    const { data } = await c.from('recordatorios').select('id')
    expect((data ?? []).length).toBe(0)
  })

  it('familia: tutor NO puede crear destino familia (solo staff)', async () => {
    const c = await clientFor(tutor)
    const { data, error } = await c
      .from('recordatorios')
      .insert({
        centro_id: centro.id,
        destinatario: 'familia',
        nino_id: nino.id,
        creado_por: tutor.id,
        titulo: 'intento ilegal',
      })
      .select('id')
      .maybeSingle()
    expect(error?.code).toBe('42501')
    expect(data).toBeNull()
  })

  // --- equipo: familia → centro -------------------------------------------
  it('equipo: tutor con flag crea (.select() ok); profe del niño lo ve', async () => {
    const cTutor = await clientFor(tutor)
    const { data, error } = await cTutor
      .from('recordatorios')
      .insert({
        centro_id: centro.id,
        destinatario: 'equipo',
        nino_id: nino.id,
        creado_por: tutor.id,
        titulo: 'hoy recoge la abuela a las 16:30',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    if (data?.id) creados.push(data.id)

    const cProfe = await clientFor(profe)
    const visto = await cProfe.from('recordatorios').select('id').eq('destinatario', 'equipo')
    expect((visto.data ?? []).length).toBeGreaterThan(0)
  })

  // --- direccion: → admins -------------------------------------------------
  it('direccion: profe crea, admin lo ve, otro tutor NO', async () => {
    const cProfe = await clientFor(profe)
    const { data, error } = await cProfe
      .from('recordatorios')
      .insert({
        centro_id: centro.id,
        destinatario: 'direccion',
        creado_por: profe.id,
        titulo: 'faltan toallitas en el aula',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    if (data?.id) creados.push(data.id)

    const cAdmin = await clientFor(admin)
    const adminVe = await cAdmin.from('recordatorios').select('id').eq('destinatario', 'direccion')
    expect((adminVe.data ?? []).length).toBeGreaterThan(0)

    const cTutor = await clientFor(tutor)
    const tutorVe = await cTutor.from('recordatorios').select('id').eq('destinatario', 'direccion')
    expect((tutorVe.data ?? []).length).toBe(0)
  })

  // --- personal ------------------------------------------------------------
  it('personal: creador lo ve, otro usuario NO', async () => {
    const cAdmin = await clientFor(admin)
    const { data, error } = await cAdmin
      .from('recordatorios')
      .insert({
        centro_id: centro.id,
        destinatario: 'personal',
        usuario_destinatario_id: admin.id,
        creado_por: admin.id,
        titulo: 'llamar al proveedor de menús',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    if (data?.id) creados.push(data.id)

    const cProfe = await clientFor(profe)
    const profeVe = await cProfe.from('recordatorios').select('id').eq('destinatario', 'personal')
    expect((profeVe.data ?? []).length).toBe(0)
  })

  it('personal: no se puede crear para otro usuario', async () => {
    const cProfe = await clientFor(profe)
    const { error } = await cProfe
      .from('recordatorios')
      .insert({
        centro_id: centro.id,
        destinatario: 'personal',
        usuario_destinatario_id: admin.id, // suplantación
        creado_por: profe.id,
        titulo: 'personal de otro',
      })
      .select('id')
      .maybeSingle()
    expect(error?.code).toBe('42501')
  })

  // --- completar idempotente / race ---------------------------------------
  it('completar: tutor completa familia; segundo intento afecta 0 filas (idempotencia)', async () => {
    // Creamos un recordatorio familia vía service para aislar el caso.
    const { data: rec } = await serviceClient
      .from('recordatorios')
      .insert({
        centro_id: centro.id,
        destinatario: 'familia',
        nino_id: nino.id,
        creado_por: admin.id,
        titulo: 'completar test',
      })
      .select('id')
      .single()
    expect(rec?.id).toBeTruthy()
    if (rec?.id) creados.push(rec.id)

    const cTutor = await clientFor(tutor)
    const first = await cTutor
      .from('recordatorios')
      .update({ completado_en: new Date().toISOString(), completado_por: tutor.id })
      .eq('id', rec!.id)
      .is('completado_en', null)
      .select('id')
      .maybeSingle()
    expect(first.error).toBeNull()
    expect(first.data?.id).toBe(rec!.id)

    // Segundo intento: ya completado → 0 filas, sin error duro.
    const second = await cTutor
      .from('recordatorios')
      .update({ completado_en: new Date().toISOString(), completado_por: tutor.id })
      .eq('id', rec!.id)
      .is('completado_en', null)
      .select('id')
      .maybeSingle()
    expect(second.error).toBeNull()
    expect(second.data).toBeNull()
  })

  // --- DELETE denegado -----------------------------------------------------
  it('DELETE: bloqueado para admin (default DENY)', async () => {
    const { data: rec } = await serviceClient
      .from('recordatorios')
      .insert({
        centro_id: centro.id,
        destinatario: 'direccion',
        creado_por: admin.id,
        titulo: 'borrar test',
      })
      .select('id')
      .single()
    if (rec?.id) creados.push(rec.id)

    const cAdmin = await clientFor(admin)
    await cAdmin.from('recordatorios').delete().eq('id', rec!.id)

    // Sigue existiendo (RLS DELETE default DENY → 0 filas afectadas, sin error).
    const { data: sigue } = await serviceClient
      .from('recordatorios')
      .select('id')
      .eq('id', rec!.id)
      .maybeSingle()
    expect(sigue?.id).toBe(rec!.id)
  })
})
