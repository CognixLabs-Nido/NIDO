import { describe, expect, it } from 'vitest'

import { PASOS_ALTA, pasoInicialAlta, type EstadoAlta } from '../estado-alta'

/**
 * Reanudación del wizard de alta (3b-2a): el paso inicial es el primer paso no
 * completado en orden. `medico`/`imagen` no tienen señal de completitud, así que la
 * reanudación nunca se atasca en un opcional; el único gate duro es `identidad`.
 */
describe('pasoInicialAlta', () => {
  const base: EstadoAlta = {
    identidadCompleta: false,
    pedagogicosCompletos: false,
    consintioDatosMedicos: false,
  }

  it('sin identidad → reanuda en identidad (gate duro)', () => {
    expect(pasoInicialAlta(base)).toBe(PASOS_ALTA.indexOf('identidad'))
  })

  it('con identidad pero sin pedagógicos → reanuda en pedagógicos', () => {
    expect(pasoInicialAlta({ ...base, identidadCompleta: true })).toBe(
      PASOS_ALTA.indexOf('pedagogicos')
    )
  })

  it('identidad + pedagógicos, sin consentimiento → reanuda en consentimientos', () => {
    expect(pasoInicialAlta({ ...base, identidadCompleta: true, pedagogicosCompletos: true })).toBe(
      PASOS_ALTA.indexOf('consentimientos')
    )
  })

  it('los tres primeros completos → aterriza en médico (opcional, revisitable)', () => {
    expect(
      pasoInicialAlta({
        identidadCompleta: true,
        pedagogicosCompletos: true,
        consintioDatosMedicos: true,
      })
    ).toBe(PASOS_ALTA.indexOf('medico'))
  })

  it('un opcional posterior nunca adelanta a uno previo incompleto', () => {
    // Sin identidad, aunque hubiera consentimiento, manda el gate duro.
    expect(pasoInicialAlta({ ...base, consintioDatosMedicos: true })).toBe(
      PASOS_ALTA.indexOf('identidad')
    )
  })
})
