import { describe, expect, it } from 'vitest'

import { PASOS_ALTA, PASO_MIN_AUTENTICADO } from '../estado-alta'

/**
 * Modelo del wizard de alta (F11-G, 8 pasos; `sepa` es el último, G-2). En `/alta`
 * (post-login) el paso `cuenta` ya está hecho, así que el wizard SIEMPRE arranca en `acuses`
 * (`PASO_MIN_AUTENTICADO`) y recorre todo en orden. El heurístico de reanudación que saltaba
 * a `medico`/`emergencia` se retiró (saltaba pasos obligatorios en la primera entrada).
 */
describe('modelo de pasos del alta', () => {
  it('el primer paso navegable post-login es acuses (cuenta queda detrás)', () => {
    expect(PASO_MIN_AUTENTICADO).toBe(PASOS_ALTA.indexOf('acuses'))
    expect(PASOS_ALTA[0]).toBe('cuenta')
  })

  it('el último paso del wizard es sepa (IBAN + mandato, G-2)', () => {
    expect(PASOS_ALTA[PASOS_ALTA.length - 1]).toBe('sepa')
    expect(PASOS_ALTA).toHaveLength(8)
  })
})
