import { describe, expect, it } from 'vitest'

import { serviceClient } from './setup'

/**
 * Helper `public.dentro_de_ventana_edicion(p_fecha)` (Fase 3, ADR-0011).
 * Devuelve true si la fecha es el día calendario actual en huso Europe/Madrid.
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

describe('public.dentro_de_ventana_edicion(fecha)', () => {
  it('devuelve true para HOY (hora Madrid)', async () => {
    const { data, error } = await serviceClient.rpc('dentro_de_ventana_edicion', {
      p_fecha: madridDateOffset(0),
    })
    expect(error).toBeNull()
    expect(data).toBe(true)
  })

  it('devuelve false para AYER', async () => {
    const { data, error } = await serviceClient.rpc('dentro_de_ventana_edicion', {
      p_fecha: madridDateOffset(-1),
    })
    expect(error).toBeNull()
    expect(data).toBe(false)
  })

  it('devuelve false para MAÑANA', async () => {
    const { data, error } = await serviceClient.rpc('dentro_de_ventana_edicion', {
      p_fecha: madridDateOffset(1),
    })
    expect(error).toBeNull()
    expect(data).toBe(false)
  })
})
