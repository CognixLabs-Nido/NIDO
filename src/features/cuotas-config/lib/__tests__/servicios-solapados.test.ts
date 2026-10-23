import { describe, expect, it } from 'vitest'

import {
  listaServicios,
  serviciosSolapados,
  type ConceptoConServicio,
} from '../servicios-solapados'

const catalogo: ConceptoConServicio[] = [
  { id: 'comedor-mensual', tipo_concepto: 'mensual', servicio: 'comedor' },
  { id: 'comedor-diario', tipo_concepto: 'diario', servicio: 'comedor' },
  { id: 'matinera-mensual', tipo_concepto: 'mensual', servicio: 'matinera' },
  { id: 'matinera-diaria', tipo_concepto: 'diario', servicio: 'matinera' },
  { id: 'vespertina-diaria', tipo_concepto: 'diario', servicio: 'vespertina' },
]

describe('serviciosSolapados (PR-4)', () => {
  it('el mensual y el diario del mismo servicio: avisa', () => {
    expect(serviciosSolapados(['comedor-mensual', 'comedor-diario'], catalogo)).toEqual(['comedor'])
  })

  it('solo el diario, o solo el mensual: no avisa', () => {
    expect(serviciosSolapados(['comedor-diario', 'vespertina-diaria'], catalogo)).toEqual([])
    expect(serviciosSolapados(['comedor-mensual'], catalogo)).toEqual([])
  })

  it('el mensual de un servicio y el diario de otro: no avisa', () => {
    expect(serviciosSolapados(['comedor-mensual', 'matinera-diaria'], catalogo)).toEqual([])
  })

  it('varios servicios, en orden fijo', () => {
    expect(
      serviciosSolapados(
        ['matinera-diaria', 'comedor-diario', 'matinera-mensual', 'comedor-mensual'],
        catalogo
      )
    ).toEqual(['comedor', 'matinera'])
  })

  it('un concepto que no está en el catálogo (sin servicio o inactivo) no cuenta', () => {
    expect(serviciosSolapados(['comedor-diario', 'cuota-sin-servicio'], catalogo)).toEqual([])
  })
})

describe('listaServicios', () => {
  it('une en minúscula como lista del idioma', () => {
    const etiqueta = (s: string) => ({ comedor: 'Comedor', matinera: 'Matinera' })[s] ?? s
    expect(listaServicios(['comedor'], etiqueta, 'es')).toBe('comedor')
    expect(listaServicios(['comedor', 'matinera'], etiqueta, 'es')).toBe('comedor y matinera')
  })
})
