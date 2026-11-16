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

  it('el último paso del wizard es sepa (IBAN + mandato, G-2), y servicios va justo antes (8b)', () => {
    expect(PASOS_ALTA[PASOS_ALTA.length - 1]).toBe('sepa')
    expect(PASOS_ALTA[PASOS_ALTA.length - 2]).toBe('servicios')
    expect(PASOS_ALTA).toHaveLength(9)
  })
})

describe('pasos del alta según el CID y los servicios del centro (0c, 2026-11-04; 8b)', () => {
  it('con CID y servicios, los nueve; sin CID, sin `sepa`, y el último es `servicios`', () => {
    expect(pasosAlta(true, true)).toEqual(PASOS_ALTA)
    const sin = pasosAlta(false, true)
    expect(sin).not.toContain('sepa')
    expect(sin).toHaveLength(PASOS_ALTA.length - 1)
    expect(sin[sin.length - 1]).toBe('servicios')
  })

  it('sin servicios en Cuotas no hay paso de servicios; sin nada, el último es `emergencia`', () => {
    const conCid = pasosAlta(true, false)
    expect(conCid).not.toContain('servicios')
    expect(conCid[conCid.length - 1]).toBe('sepa')
    const nada = pasosAlta(false, false)
    expect(nada).toHaveLength(PASOS_ALTA.length - 2)
    expect(nada[nada.length - 1]).toBe('emergencia')
  })

  it('quitar `servicios` o `sepa` no mueve ningún paso de antes (el alta se reanuda en `acuses`)', () => {
    // Premisa: los dos que se pueden quitar son los dos últimos de PASOS_ALTA.
    expect(PASOS_ALTA.slice(-2)).toEqual(['servicios', 'sepa'])
    for (const [cid, serv] of [
      [false, true],
      [true, false],
      [false, false],
    ] as const)
      pasosAlta(cid, serv)
        .filter((p) => p !== 'sepa')
        .forEach((p, i) => expect.soft(PASOS_ALTA[i], `${cid}/${serv} ${p}`).toBe(p))
  })
})
