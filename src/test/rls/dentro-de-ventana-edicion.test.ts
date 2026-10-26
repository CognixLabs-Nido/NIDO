import { describe, expect, it } from 'vitest'

import { hoyMadrid, offsetDias } from '@/features/agenda-diaria/lib/fecha'

import { serviceClient } from './setup'

/**
 * Helper `public.dentro_de_ventana_edicion(p_fecha)` (Fase 3, ADR-0011).
 * Devuelve true si la fecha es el día calendario actual en huso Europe/Madrid.
 */

/**
 * El día de calendario en Madrid a `dias` de hoy. Se cuenta en el calendario, no restando 24 h:
 * el día del cambio de hora tiene 23 o 25.
 */
function madridDateOffset(dias: number): string {
  return offsetDias(hoyMadrid(), dias)
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
