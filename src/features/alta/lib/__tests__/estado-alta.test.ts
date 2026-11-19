import { describe, expect, it } from 'vitest'

import { PASOS_ALTA, PASO_MIN_AUTENTICADO, pasosAlta } from '../estado-alta'

/**
 * Modelo del wizard de alta (F11-G). En `/alta` (post-login) el paso `cuenta` ya está hecho, así que
 * el wizard SIEMPRE arranca en `acuses` (`PASO_MIN_AUTENTICADO`) y recorre todo en orden. Desde la
 * 10b-2 el último paso es `firma` (firmar es finalizar); desde la 10b-3, también en el alta en papel.
 */
describe('modelo de pasos del alta', () => {
  it('el primer paso navegable post-login es acuses (cuenta queda detrás)', () => {
    expect(PASO_MIN_AUTENTICADO).toBe(PASOS_ALTA.indexOf('acuses'))
    expect(PASOS_ALTA[0]).toBe('cuenta')
  })

  it('el último paso es la firma de la ficha (10b-2), y antes servicios, gastos y sepa', () => {
    expect(PASOS_ALTA.slice(-4)).toEqual(['servicios', 'gastos', 'sepa', 'firma'])
    expect(PASOS_ALTA).toHaveLength(11)
  })
})

describe('pasos del alta según el CID, los servicios y los gastos (0c; 8b; 9; 10b-3)', () => {
  it('con todo, los once, y el último es `firma`; sin CID, sin `sepa`', () => {
    expect(pasosAlta(true, true, true)).toEqual(PASOS_ALTA)
    const sin = pasosAlta(false, true, true)
    expect(sin).not.toContain('sepa')
    expect(sin).toHaveLength(PASOS_ALTA.length - 1)
    expect(sin[sin.length - 1]).toBe('firma')
  })

  it('sin servicios en Cuotas no hay paso de servicios; la firma sigue la última', () => {
    const conCid = pasosAlta(true, false, false)
    expect(conCid).not.toContain('servicios')
    expect(conCid.slice(-2)).toEqual(['sepa', 'firma'])
    const nada = pasosAlta(false, false, false)
    expect(nada).toHaveLength(PASOS_ALTA.length - 3)
    expect(nada.slice(-2)).toEqual(['emergencia', 'firma'])
  })

  it('sin importe de gastos para el curso del alta, no hay paso de gastos', () => {
    const p = pasosAlta(true, true, false)
    expect(p).not.toContain('gastos')
    expect(p.slice(-3)).toEqual(['servicios', 'sepa', 'firma'])
  })

  it('quitar `servicios`, `gastos` o `sepa` no mueve ningún paso de antes, y `firma` es la última', () => {
    // Premisa: los tres que se pueden quitar van justo antes de `firma`, la última de PASOS_ALTA.
    expect(PASOS_ALTA.slice(-4)).toEqual(['servicios', 'gastos', 'sepa', 'firma'])
    const opcionales = new Set(['sepa', 'gastos', 'servicios', 'firma'])
    for (const cid of [true, false])
      for (const serv of [true, false])
        for (const gastos of [true, false]) {
          const pasos = pasosAlta(cid, serv, gastos)
          expect.soft(pasos[pasos.length - 1], `${cid}/${serv}/${gastos}`).toBe('firma')
          pasos
            .filter((p) => !opcionales.has(p))
            .forEach((p, i) => expect.soft(PASOS_ALTA[i], `${cid}/${serv}/${gastos} ${p}`).toBe(p))
        }
  })
})
