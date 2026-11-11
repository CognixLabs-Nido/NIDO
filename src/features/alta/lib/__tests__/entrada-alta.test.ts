import { describe, expect, it } from 'vitest'

import { resolverEntradaAlta } from '../entrada-alta'

/**
 * PR-3b-2 · B1 — tests de aislamiento del gate de entrada al wizard de alta.
 * Verifican el límite de seguridad "quién entra y cómo" en la función pura que
 * consume la ruta `/alta/[ninoId]`. El `rolEnCentroNino` que recibe la función lo
 * resuelve la ruta con `contextoEnCentro(nino.centro_id)` (atado al centro DEL NIÑO):
 * un admin de OTRO centro no tiene rol ahí → llega como `null`.
 */
describe('resolverEntradaAlta (gate B1 modo Dirección)', () => {
  it('tutor legal con vínculo → entrada normal de tutor (sin modo Dirección)', () => {
    expect(
      resolverEntradaAlta({ tipoVinculo: 'tutor_legal_principal', rolEnCentroNino: 'tutor_legal' })
    ).toEqual({
      tipo: 'tutor',
    })
  })

  it('autorizado con vínculo → a su inicio: el alta es del tutor legal (2026-11-11)', () => {
    expect(
      resolverEntradaAlta({ tipoVinculo: 'autorizado', rolEnCentroNino: 'autorizado' })
    ).toEqual({ tipo: 'redirect', destino: 'family' })
  })

  it('autorizado que además es admin del centro → también a su inicio: manda el vínculo', () => {
    expect(resolverEntradaAlta({ tipoVinculo: 'autorizado', rolEnCentroNino: 'admin' })).toEqual({
      tipo: 'redirect',
      destino: 'family',
    })
  })

  it('tutor legal secundario con vínculo → entrada normal de tutor', () => {
    expect(
      resolverEntradaAlta({ tipoVinculo: 'tutor_legal_secundario', rolEnCentroNino: 'tutor_legal' })
    ).toEqual({ tipo: 'tutor' })
  })

  it('admin DEL CENTRO DEL NIÑO sin vínculo → MODO DIRECCIÓN', () => {
    expect(resolverEntradaAlta({ tipoVinculo: null, rolEnCentroNino: 'admin' })).toEqual({
      tipo: 'direccion',
    })
  })

  it('admin de OTRO centro (sin rol en el centro del niño → null) → notFound (rebotado)', () => {
    expect(resolverEntradaAlta({ tipoVinculo: null, rolEnCentroNino: null })).toEqual({
      tipo: 'notfound',
    })
  })

  it('profe del centro del niño sin vínculo → redirect a su panel (rebotado del wizard)', () => {
    expect(resolverEntradaAlta({ tipoVinculo: null, rolEnCentroNino: 'profe' })).toEqual({
      tipo: 'redirect',
      destino: 'teacher',
    })
  })

  it('autorizado sin vínculo (rol autorizado, sin vínculo activo) → notFound', () => {
    expect(resolverEntradaAlta({ tipoVinculo: null, rolEnCentroNino: 'autorizado' })).toEqual({
      tipo: 'notfound',
    })
  })

  it('usuario sin rol en el centro del niño → notFound', () => {
    expect(resolverEntradaAlta({ tipoVinculo: null, rolEnCentroNino: null })).toEqual({
      tipo: 'notfound',
    })
  })

  it('admin CON vínculo (caso raro: admin que además es tutor) → entra como tutor, no como Dirección', () => {
    // El vínculo tiene prioridad: si el admin es a la vez tutor del niño, recorre el
    // flujo de tutor normal (firma digital a su nombre de tutor), no el de Dirección.
    expect(
      resolverEntradaAlta({ tipoVinculo: 'tutor_legal_principal', rolEnCentroNino: 'admin' })
    ).toEqual({
      tipo: 'tutor',
    })
  })
})
