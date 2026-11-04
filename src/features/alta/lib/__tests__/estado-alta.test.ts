import { describe, expect, it } from 'vitest'

import { PASOS_ALTA, PASO_MIN_AUTENTICADO, pasosAlta } from '../estado-alta'

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

describe('pasos del alta según el CID del centro (0c, 2026-11-04)', () => {
  it('con CID, los ocho; sin CID, sin `sepa`, y el último es `emergencia`', () => {
    expect(pasosAlta(true)).toEqual(PASOS_ALTA)
    const sin = pasosAlta(false)
    expect(sin).not.toContain('sepa')
    expect(sin).toHaveLength(PASOS_ALTA.length - 1)
    expect(sin[sin.length - 1]).toBe('emergencia')
  })

  it('quitar `sepa` no mueve ningún otro paso (la reanudación indexa sobre PASOS_ALTA)', () => {
    // Premisa: `sepa` es el último de PASOS_ALTA.
    expect(PASOS_ALTA[PASOS_ALTA.length - 1]).toBe('sepa')
    pasosAlta(false).forEach((p, i) => expect.soft(PASOS_ALTA[i], p).toBe(p))
  })
})
