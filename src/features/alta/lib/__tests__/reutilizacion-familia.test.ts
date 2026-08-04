import { describe, expect, it } from 'vitest'

import { resolverReutilizacionFamilia, type SenalesFamiliaAlta } from '../reutilizacion-familia'

/** Familia nueva (1.er hijo): nada heredado, todo por rellenar. */
const PRIMER_HIJO: SenalesFamiliaAlta = {
  tieneHermanos: false,
  tutor1ConNombre: false,
  tutor1ConDni: false,
  mandatoFamiliaActivo: false,
}

/** 2.º hijo de una familia con el alta del 1.º ya completa. */
const SEGUNDO_HIJO: SenalesFamiliaAlta = {
  tieneHermanos: true,
  tutor1ConNombre: true,
  tutor1ConDni: true,
  mandatoFamiliaActivo: true,
}

describe('resolverReutilizacionFamilia (U-3)', () => {
  it('1.er hijo: no reutiliza nada — el wizard pide el alta entera', () => {
    expect(resolverReutilizacionFamilia(PRIMER_HIJO)).toEqual({
      tutor: false,
      sepa: false,
      hayReutilizacion: false,
    })
  })

  it('2.º hijo con la familia completa: reutiliza tutor y SEPA', () => {
    expect(resolverReutilizacionFamilia(SEGUNDO_HIJO)).toEqual({
      tutor: true,
      sepa: true,
      hayReutilizacion: true,
    })
  })

  it('sin hermanos NO reutiliza el tutor aunque el perfil esté completo (reintento del 1.er hijo)', () => {
    // Caso real: el tutor guardó sus datos y volvió al wizard. No es un 2.º hijo → sigue el
    // flujo normal (el formulario ya viene pre-relleno por la ruta, que es otra cosa).
    const r = resolverReutilizacionFamilia({
      ...PRIMER_HIJO,
      tutor1ConNombre: true,
      tutor1ConDni: true,
    })
    expect(r.tutor).toBe(false)
    expect(r.hayReutilizacion).toBe(false)
  })

  it('perfil compartido a medias (sin DNI) NO se da por resuelto: el gate lo exigiría', () => {
    const r = resolverReutilizacionFamilia({ ...SEGUNDO_HIJO, tutor1ConDni: false })
    expect(r.tutor).toBe(false)
  })

  it('perfil compartido sin nombre tampoco se da por resuelto', () => {
    const r = resolverReutilizacionFamilia({ ...SEGUNDO_HIJO, tutor1ConNombre: false })
    expect(r.tutor).toBe(false)
  })

  it('2.º hijo sin mandato: el tutor sí se reutiliza, el SEPA no (se firmará ahora)', () => {
    const r = resolverReutilizacionFamilia({ ...SEGUNDO_HIJO, mandatoFamiliaActivo: false })
    expect(r).toEqual({ tutor: true, sepa: false, hayReutilizacion: true })
  })

  it('SEPA activo sin hermanos: informativo (F-2c-2) pero sin aviso de familia existente', () => {
    // El mandato es de la FAMILIA desde F-2c-1: un reintento del 1.er hijo ya lo veía
    // informativo. Eso no convierte el alta en "2.º hijo" → no se anuncia reutilización.
    const r = resolverReutilizacionFamilia({ ...PRIMER_HIJO, mandatoFamiliaActivo: true })
    expect(r.sepa).toBe(true)
    expect(r.hayReutilizacion).toBe(false)
  })
})
