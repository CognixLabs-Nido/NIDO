import { describe, expect, it } from 'vitest'

import { PASOS_ALTA, PASO_MIN_AUTENTICADO, pasoInicialAlta, type EstadoAlta } from '../estado-alta'

/**
 * Reanudación del wizard de alta (F11-G, 7 pasos). En `/alta` (post-login) el paso
 * `cuenta` ya está hecho, así que la reanudación nunca aterriza antes de `acuses`. El
 * único gate duro es la identidad; el acuse médico decide el salto a `medico`.
 */
describe('pasoInicialAlta', () => {
  const base: EstadoAlta = {
    identidadCompleta: false,
    consintioDatosMedicos: false,
  }

  it('sin identidad → reanuda en acuses (arranque del flujo post-cuenta)', () => {
    expect(pasoInicialAlta(base)).toBe(PASOS_ALTA.indexOf('acuses'))
  })

  it('con identidad pero sin acuse médico → reanuda en médico', () => {
    expect(pasoInicialAlta({ ...base, identidadCompleta: true })).toBe(PASOS_ALTA.indexOf('medico'))
  })

  it('identidad + acuse médico → aterriza en emergencia (último paso, revisable)', () => {
    expect(pasoInicialAlta({ identidadCompleta: true, consintioDatosMedicos: true })).toBe(
      PASOS_ALTA.indexOf('emergencia')
    )
  })

  it('el primer paso navegable post-login es acuses (cuenta queda detrás)', () => {
    expect(PASO_MIN_AUTENTICADO).toBe(PASOS_ALTA.indexOf('acuses'))
    expect(PASOS_ALTA[0]).toBe('cuenta')
  })
})
