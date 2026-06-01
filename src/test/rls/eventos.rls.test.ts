import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  asignarProfeAula,
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  createTestUser,
  type TestUser,
} from './setup'

/**
 * RLS de `eventos` y `confirmaciones_evento` (F7). **Gated** por
 * `EVENTOS_MIGRATION_APPLIED=1`: la migración
 * `20260601140000_phase7_eventos.sql` se aplica manualmente vía Supabase SQL
 * Editor (CLI con bug SIGILL en Penguin). Hasta entonces estos tests se omiten
 * para no romper la suite.
 *
 * Comando para correrlos tras aplicar la migración:
 *   EVENTOS_MIGRATION_APPLIED=1 npm run test:rls -- eventos.rls
 *
 * Cubre: INSERT por rol×ámbito (admin/profe; tutor denegado), el gotcha MVCC
 * `.insert().select()` en los 3 ámbitos (helper row-aware), la visibilidad
 * SELECT por audiencia (incl. aislamiento por centro), confirmación solo por un
 * tutor del niño, y DELETE denegado.
 */
const MIGRATION_APPLIED = process.env.EVENTOS_MIGRATION_APPLIED === '1'

describe.skipIf(!MIGRATION_APPLIED)('RLS eventos — F7 (calendario y eventos)', () => {
  let centro: { id: string }
  let centroB: { id: string }
  let aula: { id: string }
  let aulaB: { id: string }
  let admin: TestUser
  let profe: TestUser
  let tutor: TestUser
  let tutorOtro: TestUser
  let nino: { id: string }
  let ninoB: { id: string }
  const creados: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro Eventos')
    centroB = await createTestCentro('Centro Eventos B')
    const curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id, 'Aula Eventos')
    aulaB = await createTestAula(centro.id, curso.id, 'Aula Eventos B')
    nino = await createTestNino(centro.id, 'Evento Nino')
    ninoB = await createTestNino(centro.id, 'Evento Nino B')
    await matricular(nino.id, aula.id, curso.id)
    await matricular(ninoB.id, aulaB.id, curso.id)

    admin = await createTestUser({ nombre: 'Admin Ev' })
    profe = await createTestUser({ nombre: 'Profe Ev' })
    tutor = await createTestUser({ nombre: 'Tutor Ev' })
    tutorOtro = await createTestUser({ nombre: 'Tutor Otro Ev' })

    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    await asignarRol(tutorOtro.id, centroB.id, 'tutor_legal')
    await asignarProfeAula(profe.id, aula.id)
    await crearVinculo(nino.id, tutor.id, 'tutor_legal_principal', { puede_recibir_mensajes: true })
  })

  afterAll(async () => {
    for (const id of creados) await serviceClient.from('eventos').delete().eq('id', id)
    await deleteTestCentro(centro.id)
    await deleteTestCentro(centroB.id)
    for (const u of [admin, profe, tutor, tutorOtro]) await deleteTestUser(u.id)
  })

  async function insertarComo(
    user: TestUser,
    row: Record<string, unknown>
  ): Promise<{ id?: string; error: unknown }> {
    const c = await clientFor(user)
    const payload = {
      tipo: 'reunion',
      titulo: 'Test',
      fecha: '2026-09-10',
      creado_por: user.id,
      ...row,
    } as Database['public']['Tables']['eventos']['Insert']
    const { data, error } = await c.from('eventos').insert(payload).select('id').maybeSingle()
    if (data?.id) creados.push(data.id)
    return { id: data?.id, error }
  }

  it('admin crea evento de centro/aula/niño (.insert().select() — MVCC)', async () => {
    const c = await insertarComo(admin, { ambito: 'centro', centro_id: centro.id })
    expect(c.error).toBeNull()
    expect(c.id).toBeTruthy()
    const a = await insertarComo(admin, { ambito: 'aula', centro_id: centro.id, aula_id: aula.id })
    expect(a.error).toBeNull()
    expect(a.id).toBeTruthy()
    const n = await insertarComo(admin, { ambito: 'nino', centro_id: centro.id, nino_id: nino.id })
    expect(n.error).toBeNull()
    expect(n.id).toBeTruthy()
  })

  it('profe crea evento de su aula, pero no de centro ni de otra aula', async () => {
    const ok = await insertarComo(profe, { ambito: 'aula', centro_id: centro.id, aula_id: aula.id })
    expect(ok.id).toBeTruthy()
    const centroFail = await insertarComo(profe, { ambito: 'centro', centro_id: centro.id })
    expect(centroFail.id).toBeFalsy()
    const aulaBFail = await insertarComo(profe, {
      ambito: 'aula',
      centro_id: centro.id,
      aula_id: aulaB.id,
    })
    expect(aulaBFail.id).toBeFalsy()
  })

  it('tutor no puede crear eventos', async () => {
    const r = await insertarComo(tutor, { ambito: 'aula', centro_id: centro.id, aula_id: aula.id })
    expect(r.id).toBeFalsy()
  })

  it('tutor ve los eventos de su audiencia; un tutor de otro centro no', async () => {
    const { data: ev } = await serviceClient
      .from('eventos')
      .insert({
        ambito: 'aula',
        centro_id: centro.id,
        aula_id: aula.id,
        tipo: 'excursion',
        titulo: 'Visible',
        fecha: '2026-10-01',
        creado_por: admin.id,
      })
      .select('id')
      .single()
    if (ev) creados.push(ev.id)

    const cTutor = await clientFor(tutor)
    const { data: vistos } = await cTutor.from('eventos').select('id').eq('id', ev!.id)
    expect(vistos?.length).toBe(1)

    const cOtro = await clientFor(tutorOtro)
    const { data: noVistos } = await cOtro.from('eventos').select('id').eq('id', ev!.id)
    expect(noVistos?.length ?? 0).toBe(0)
  })

  it('un tutor confirma por su niño, no por un niño ajeno', async () => {
    const { data: ev } = await serviceClient
      .from('eventos')
      .insert({
        ambito: 'aula',
        centro_id: centro.id,
        aula_id: aula.id,
        tipo: 'excursion',
        titulo: 'Con confirmación',
        fecha: '2026-11-01',
        requiere_confirmacion: true,
        creado_por: admin.id,
      })
      .select('id')
      .single()
    if (ev) creados.push(ev.id)

    const cTutor = await clientFor(tutor)
    const okConf = await cTutor
      .from('confirmaciones_evento')
      .upsert(
        { evento_id: ev!.id, nino_id: nino.id, estado: 'confirmado', confirmado_por: tutor.id },
        { onConflict: 'evento_id,nino_id' }
      )
      .select('id')
      .maybeSingle()
    expect(okConf.data?.id).toBeTruthy()

    const ajeno = await cTutor
      .from('confirmaciones_evento')
      .upsert(
        { evento_id: ev!.id, nino_id: ninoB.id, estado: 'confirmado', confirmado_por: tutor.id },
        { onConflict: 'evento_id,nino_id' }
      )
      .select('id')
      .maybeSingle()
    expect(ajeno.data?.id).toBeFalsy()
  })

  it('DELETE de eventos está denegado a todos', async () => {
    const { data: ev } = await serviceClient
      .from('eventos')
      .insert({
        ambito: 'centro',
        centro_id: centro.id,
        tipo: 'otro',
        titulo: 'No borrable',
        fecha: '2026-12-01',
        creado_por: admin.id,
      })
      .select('id')
      .single()
    if (ev) creados.push(ev.id)

    const cAdmin = await clientFor(admin)
    await cAdmin.from('eventos').delete().eq('id', ev!.id)
    const { data: sigue } = await serviceClient.from('eventos').select('id').eq('id', ev!.id)
    expect(sigue?.length).toBe(1)
  })
})
