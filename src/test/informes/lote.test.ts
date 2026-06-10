import { describe, expect, it } from 'vitest'

import { resumenLote, sellarNotificado } from '@/features/informes/lib/lote'
import type { ActionResult } from '@/features/informes/types'

/**
 * F9-5-3 — Lógica pura del publicar en lote. `sellarNotificado` garantiza que cada
 * informe avisa a la familia **una sola vez** (Q8); `resumenLote` agrega el
 * resultado best-effort (publicados vs incompletos).
 */

const ok: ActionResult<{ informe_id: string }> = { success: true, data: { informe_id: 'x' } }
const fail: ActionResult<never> = { success: false, error: 'informes.errors.faltan_valoraciones' }

describe('sellarNotificado', () => {
  it('estampa la fecha en la PRIMERA publicación (no había sello)', () => {
    expect(sellarNotificado(null, '2026-06-10T10:00:00Z')).toBe('2026-06-10T10:00:00Z')
  })

  it('conserva el sello previo al republicar (no re-avisa — Q8)', () => {
    const previo = '2026-06-01T09:00:00Z'
    expect(sellarNotificado(previo, '2026-06-10T10:00:00Z')).toBe(previo)
  })
})

describe('resumenLote', () => {
  it('cuenta publicados e incompletos en una mezcla (best-effort)', () => {
    const r = resumenLote([ok, fail, ok, fail, ok])
    expect(r).toEqual({ total: 5, publicados: 3, incompletos: 2 })
  })

  it('todos completos → 0 incompletos', () => {
    expect(resumenLote([ok, ok])).toEqual({ total: 2, publicados: 2, incompletos: 0 })
  })

  it('todos incompletos → 0 publicados', () => {
    expect(resumenLote([fail, fail, fail])).toEqual({ total: 3, publicados: 0, incompletos: 3 })
  })

  it('lista vacía → todo a cero', () => {
    expect(resumenLote([])).toEqual({ total: 0, publicados: 0, incompletos: 0 })
  })
})
