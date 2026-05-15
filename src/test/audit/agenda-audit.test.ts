import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  deleteTestCentro,
  matricular,
  serviceClient,
} from '../rls/setup'

/**
 * Audit log automático sobre la agenda diaria (Fase 3).
 * Triggers `AFTER INSERT/UPDATE/DELETE` en las 5 tablas usan
 * `audit_trigger_function()` extendida para derivar centro_id vía
 * helpers SECURITY DEFINER (`centro_de_nino`, `centro_de_agenda`).
 */

function madridDateToday(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = fmt.formatToParts(new Date())
  return [
    parts.find((p) => p.type === 'year')!.value,
    parts.find((p) => p.type === 'month')!.value,
    parts.find((p) => p.type === 'day')!.value,
  ].join('-')
}

describe('Audit log — agendas_diarias y comidas (Fase 3)', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let nino: { id: string }
  let matriculaId: string
  let agendaId: string

  beforeAll(async () => {
    centro = await createTestCentro('Centro Audit Agenda')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id, 'Audit Agenda')
    matriculaId = await matricular(nino.id, aula.id, curso.id)
  }, 60_000)

  afterAll(async () => {
    if (agendaId) {
      // ON DELETE CASCADE en hijos limpia las comidas, biberones, etc.
      await serviceClient.from('agendas_diarias').delete().eq('id', agendaId)
    }
    if (matriculaId) {
      await serviceClient.from('matriculas').delete().eq('id', matriculaId)
    }
    if (nino?.id) {
      await serviceClient.from('ninos').delete().eq('id', nino.id)
    }
    await serviceClient.from('aulas').delete().eq('id', aula.id)
    await serviceClient.from('cursos_academicos').delete().eq('id', curso.id)
    await deleteTestCentro(centro.id)
  }, 60_000)

  it('INSERT en comidas genera audit_log con centro_id derivado vía centro_de_agenda', async () => {
    // Setup: una agenda padre para el niño (hoy) y luego una comida.
    const { data: agenda, error: agendaErr } = await serviceClient
      .from('agendas_diarias')
      .insert({ nino_id: nino.id, fecha: madridDateToday() })
      .select('id')
      .single()
    expect(agendaErr).toBeNull()
    expect(agenda?.id).toBeTruthy()
    agendaId = agenda!.id

    const { data: comida, error: comidaErr } = await serviceClient
      .from('comidas')
      .insert({
        agenda_id: agendaId,
        momento: 'comida',
        cantidad: 'mayoria',
        descripcion: 'lentejas con verduras',
      })
      .select('id')
      .single()
    expect(comidaErr).toBeNull()
    expect(comida?.id).toBeTruthy()

    const { data, error } = await serviceClient
      .from('audit_log')
      .select('tabla, accion, centro_id, valores_antes, valores_despues')
      .eq('tabla', 'comidas')
      .eq('registro_id', comida!.id)
      .single()
    expect(error).toBeNull()
    expect(data?.accion).toBe('INSERT')
    expect(data?.centro_id).toBe(centro.id)
    expect(data?.valores_antes).toBeNull()
    const despues = data?.valores_despues as Record<string, unknown> | null
    expect(despues?.cantidad).toBe('mayoria')
    expect(despues?.descripcion).toBe('lentejas con verduras')
  })

  it('UPDATE en agendas_diarias captura valores_antes y valores_despues', async () => {
    const { error: updateErr } = await serviceClient
      .from('agendas_diarias')
      .update({ humor: 'feliz', observaciones_generales: 'gran día' })
      .eq('id', agendaId)
    expect(updateErr).toBeNull()

    const { data, error } = await serviceClient
      .from('audit_log')
      .select('accion, valores_antes, valores_despues, centro_id')
      .eq('tabla', 'agendas_diarias')
      .eq('registro_id', agendaId)
      .eq('accion', 'UPDATE')
      .order('ts', { ascending: false })
      .limit(1)
      .single()
    expect(error).toBeNull()
    expect(data?.accion).toBe('UPDATE')
    expect(data?.centro_id).toBe(centro.id)
    const antes = data?.valores_antes as Record<string, unknown> | null
    const despues = data?.valores_despues as Record<string, unknown> | null
    expect(antes?.humor).toBeNull()
    expect(despues?.humor).toBe('feliz')
    expect(despues?.observaciones_generales).toBe('gran día')
  })
})
