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

  it('el último paso del wizard es sepa (G-2), y antes servicios (8b) y gastos (9)', () => {
    expect(PASOS_ALTA.slice(-3)).toEqual(['servicios', 'gastos', 'sepa'])
    expect(PASOS_ALTA).toHaveLength(10)
  })
})

describe('pasos del alta según el CID, los servicios y los gastos (0c, 2026-11-04; 8b; 9)', () => {
  it('con todo, los diez; sin CID, sin `sepa`, y el último es `gastos`', () => {
    expect(pasosAlta(true, true, true)).toEqual(PASOS_ALTA)
    const sin = pasosAlta(false, true, true)
    expect(sin).not.toContain('sepa')
    expect(sin).toHaveLength(PASOS_ALTA.length - 1)
    expect(sin[sin.length - 1]).toBe('gastos')
  })

  it('sin servicios en Cuotas no hay paso de servicios; sin nada, el último es `emergencia`', () => {
    const conCid = pasosAlta(true, false, false)
    expect(conCid).not.toContain('servicios')
    expect(conCid[conCid.length - 1]).toBe('sepa')
    const nada = pasosAlta(false, false, false)
    expect(nada).toHaveLength(PASOS_ALTA.length - 3)
    expect(nada[nada.length - 1]).toBe('emergencia')
  })

  it('sin importe de gastos para el curso del alta, no hay paso de gastos', () => {
    const p = pasosAlta(true, true, false)
    expect(p).not.toContain('gastos')
    expect(p.slice(-2)).toEqual(['servicios', 'sepa'])
  })

  it('quitar `servicios`, `gastos` o `sepa` no mueve ningún paso de antes (se reanuda en `acuses`)', () => {
    // Premisa: los tres que se pueden quitar son los tres últimos de PASOS_ALTA.
    expect(PASOS_ALTA.slice(-3)).toEqual(['servicios', 'gastos', 'sepa'])
    for (const cid of [true, false])
      for (const serv of [true, false])
        for (const gastos of [true, false])
          pasosAlta(cid, serv, gastos)
            .filter((p) => p !== 'sepa' && p !== 'gastos' && p !== 'servicios')
            .forEach((p, i) => expect.soft(PASOS_ALTA[i], `${cid}/${serv}/${gastos} ${p}`).toBe(p))
  })
})
