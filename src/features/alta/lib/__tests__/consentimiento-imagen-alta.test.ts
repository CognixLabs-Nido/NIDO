import { describe, expect, it } from 'vitest'

import { puedeConsentirImagenAlta } from '../consentimiento-imagen-alta'

describe('puedeConsentirImagenAlta — quién ve la sección de imagen del alta', () => {
  it('tutor legal principal y secundario: sí', () => {
    expect(
      puedeConsentirImagenAlta({ modoDireccion: false, tipoVinculo: 'tutor_legal_principal' })
    ).toBe(true)
    expect(
      puedeConsentirImagenAlta({ modoDireccion: false, tipoVinculo: 'tutor_legal_secundario' })
    ).toBe(true)
  })

  it('vínculo autorizado (recogida): no', () => {
    expect(puedeConsentirImagenAlta({ modoDireccion: false, tipoVinculo: 'autorizado' })).toBe(
      false
    )
  })

  it('vínculo admin o sin vínculo fuera de modo Dirección: no', () => {
    expect(puedeConsentirImagenAlta({ modoDireccion: false, tipoVinculo: 'admin' })).toBe(false)
    expect(puedeConsentirImagenAlta({ modoDireccion: false, tipoVinculo: null })).toBe(false)
  })

  it('modo Dirección (firma presencial): sí, aunque no tenga vínculo', () => {
    expect(puedeConsentirImagenAlta({ modoDireccion: true, tipoVinculo: null })).toBe(true)
  })
})
