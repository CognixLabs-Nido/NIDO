import { describe, expect, it } from 'vitest'

import { PASOS_ALTA, PASO_MIN_AUTENTICADO, pasosAlta } from '../estado-alta'

/**
 * Modelo del wizard de alta (F11-G). En `/alta` (post-login) el paso `cuenta` ya está hecho, así que
 * el wizard SIEMPRE arranca en `acuses` (`PASO_MIN_AUTENTICADO`) y recorre todo en orden. Desde la
 * 10b-2 el último paso de la familia es `firma` (firmar es finalizar); el alta en papel no lo tiene.
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

describe('pasos del alta según el CID, los servicios, los gastos y quién la hace (0c; 8b; 9; 10b-2)', () => {
  it('con todo y la familia, los once, y el último es `firma`; sin CID, sin `sepa`', () => {
    expect(pasosAlta(true, true, true, true)).toEqual(PASOS_ALTA)
    const sin = pasosAlta(false, true, true, true)
    expect(sin).not.toContain('sepa')
    expect(sin).toHaveLength(PASOS_ALTA.length - 1)
    expect(sin[sin.length - 1]).toBe('firma')
  })

  it('el alta en papel no tiene paso de firma: el último que queda finaliza', () => {
    const papel = pasosAlta(true, true, true, false)
    expect(papel).not.toContain('firma')
    expect(papel[papel.length - 1]).toBe('sepa')
    const papelNada = pasosAlta(false, false, false, false)
    expect(papelNada[papelNada.length - 1]).toBe('emergencia')
  })

  it('sin servicios en Cuotas no hay paso de servicios; con la familia, la firma sigue la última', () => {
    const conCid = pasosAlta(true, false, false, true)
    expect(conCid).not.toContain('servicios')
    expect(conCid.slice(-2)).toEqual(['sepa', 'firma'])
    const nada = pasosAlta(false, false, false, true)
    expect(nada).toHaveLength(PASOS_ALTA.length - 3)
    expect(nada.slice(-2)).toEqual(['emergencia', 'firma'])
  })

  it('sin importe de gastos para el curso del alta, no hay paso de gastos', () => {
    const p = pasosAlta(true, true, false, true)
    expect(p).not.toContain('gastos')
    expect(p.slice(-3)).toEqual(['servicios', 'sepa', 'firma'])
  })

  it('quitar `servicios`, `gastos`, `sepa` o `firma` no mueve ningún paso de antes', () => {
    // Premisa: los cuatro que se pueden quitar son los cuatro últimos de PASOS_ALTA.
    expect(PASOS_ALTA.slice(-4)).toEqual(['servicios', 'gastos', 'sepa', 'firma'])
    const opcionales = new Set(['sepa', 'gastos', 'servicios', 'firma'])
    for (const cid of [true, false])
      for (const serv of [true, false])
        for (const gastos of [true, false])
          for (const firma of [true, false])
            pasosAlta(cid, serv, gastos, firma)
              .filter((p) => !opcionales.has(p))
              .forEach((p, i) =>
                expect.soft(PASOS_ALTA[i], `${cid}/${serv}/${gastos}/${firma} ${p}`).toBe(p)
              )
  })
})
