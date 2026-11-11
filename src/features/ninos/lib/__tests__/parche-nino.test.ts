import { describe, expect, it } from 'vitest'

import { parcheNinoDireccion } from '../parche-nino'

/**
 * El parche que escribe la Dirección (fase 5b) aplica la MISMA regla que
 * `actualizar_identidad_nino_tutor` aplica a la tutora: NULL deja lo que hay, vacío borra, el DNI
 * normalizado, los apellidos en pareja y el texto de «otro» solo con «otro».
 */
const BASE = {
  nino_id: '11111111-1111-4111-8111-111111111111',
  nombre: 'Niño Demo 1',
  primer_apellido: ' Demo ',
  segundo_apellido: '',
  fecha_nacimiento: '2024-03-15',
  sexo: null,
  nacionalidad: ' española ',
  idioma_principal: 'es' as const,
  lugar_nacimiento: ' Valencia ',
  dni: null,
  hermanos_total: 2,
  hermanos_lugar: 1,
  observaciones_familia: null,
  como_nos_conocio: null,
  como_nos_conocio_otro: null,
}

describe('parcheNinoDireccion — la regla de la función de la tutora', () => {
  it('recorta y pone en pareja los apellidos; el segundo vacío es «no tiene»', () => {
    const p = parcheNinoDireccion(BASE)
    expect(p).toMatchObject({
      primer_apellido: 'Demo',
      segundo_apellido: null,
      nacionalidad: 'española',
      lugar_nacimiento: 'Valencia',
    })
  })

  it('NULL es «dejar lo que hay»: sexo, DNI, observaciones y «cómo nos conoció» no van en el parche', () => {
    const p = parcheNinoDireccion(BASE)
    for (const k of [
      'sexo',
      'dni',
      'observaciones_familia',
      'como_nos_conocio',
      'como_nos_conocio_otro',
    ])
      expect.soft(k in p, k).toBe(false)
  })

  it('vacío borra; el DNI va normalizado', () => {
    const p = parcheNinoDireccion({
      ...BASE,
      dni: '12.345.678-z',
      observaciones_familia: '  ',
      como_nos_conocio: '',
    })
    expect(p).toMatchObject({
      dni: '12345678Z',
      observaciones_familia: null,
      como_nos_conocio: null,
      como_nos_conocio_otro: null,
    })
    expect(parcheNinoDireccion({ ...BASE, dni: '' }).dni).toBeNull()
  })

  it('el texto de «otro» solo viaja con «otro»', () => {
    expect(
      parcheNinoDireccion({
        ...BASE,
        como_nos_conocio: 'otro',
        como_nos_conocio_otro: ' Un cartel ',
      })
    ).toMatchObject({ como_nos_conocio: 'otro', como_nos_conocio_otro: 'Un cartel' })
    expect(
      parcheNinoDireccion({ ...BASE, como_nos_conocio: 'internet', como_nos_conocio_otro: 'no' })
    ).toMatchObject({ como_nos_conocio: 'internet', como_nos_conocio_otro: null })
  })
})
