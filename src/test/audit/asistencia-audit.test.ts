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
 * Audit log automático sobre asistencias y ausencias (Fase 4).
 * audit_trigger_function() extendida con 2 ramas nuevas. Cada cambio
 * en asistencias / ausencias deja una fila en audit_log con centro_id
 * derivado via centro_de_nino.
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

describe('Audit log — asistencias y ausencias (Fase 4)', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let nino: { id: string }
  let matriculaId: string
  let asistenciaId: string
  let ausenciaId: string

  beforeAll(async () => {
    centro = await createTestCentro('Centro Audit Asist')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id, 'Audit Asist')
    matriculaId = await matricular(nino.id, aula.id, curso.id)
  }, 60_000)

  afterAll(async () => {
    if (asistenciaId) await serviceClient.from('asistencias').delete().eq('id', asistenciaId)
    if (ausenciaId) await serviceClient.from('ausencias').delete().eq('id', ausenciaId)
    if (matriculaId) await serviceClient.from('matriculas').delete().eq('id', matriculaId)
    if (nino?.id) await serviceClient.from('ninos').delete().eq('id', nino.id)
    await serviceClient.from('aulas').delete().eq('id', aula.id)
    await serviceClient.from('cursos_academicos').delete().eq('id', curso.id)
    await deleteTestCentro(centro.id)
  }, 60_000)

  it('INSERT en asistencias genera audit_log con centro_id correcto', async () => {
    const { data, error } = await serviceClient
      .from('asistencias')
      .insert({
        nino_id: nino.id,
        fecha: madridDateToday(),
        estado: 'presente',
        hora_llegada: '09:00',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    asistenciaId = data!.id

    const { data: audit, error: auditErr } = await serviceClient
      .from('audit_log')
      .select('tabla, accion, centro_id, valores_despues')
      .eq('tabla', 'asistencias')
      .eq('registro_id', asistenciaId)
      .single()
    expect(auditErr).toBeNull()
    expect(audit?.accion).toBe('INSERT')
    expect(audit?.centro_id).toBe(centro.id)
    const despues = audit?.valores_despues as Record<string, unknown> | null
    expect(despues?.estado).toBe('presente')
  })

  it('UPDATE en ausencias captura valores_antes y valores_despues', async () => {
    // Setup: una ausencia, luego UPDATE.
    const { data: created, error: createErr } = await serviceClient
      .from('ausencias')
      .insert({
        nino_id: nino.id,
        fecha_inicio: madridDateToday(),
        fecha_fin: madridDateToday(),
        motivo: 'enfermedad',
        descripcion: 'gripe',
      })
      .select('id')
      .single()
    expect(createErr).toBeNull()
    ausenciaId = created!.id

    const { error: updateErr } = await serviceClient
      .from('ausencias')
      .update({ descripcion: '[cancelada] gripe' })
      .eq('id', ausenciaId)
    expect(updateErr).toBeNull()

    const { data: audit, error: auditErr } = await serviceClient
      .from('audit_log')
      .select('accion, valores_antes, valores_despues, centro_id')
      .eq('tabla', 'ausencias')
      .eq('registro_id', ausenciaId)
      .eq('accion', 'UPDATE')
      .order('ts', { ascending: false })
      .limit(1)
      .single()
    expect(auditErr).toBeNull()
    expect(audit?.accion).toBe('UPDATE')
    expect(audit?.centro_id).toBe(centro.id)
    const antes = audit?.valores_antes as Record<string, unknown> | null
    const despues = audit?.valores_despues as Record<string, unknown> | null
    expect(antes?.descripcion).toBe('gripe')
    expect(despues?.descripcion).toBe('[cancelada] gripe')
  })
})
