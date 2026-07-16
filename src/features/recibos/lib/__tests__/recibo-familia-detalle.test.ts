import { describe, expect, it } from 'vitest'

import { agruparLineasPorHijo, type LineaConNino } from '../recibo-familia-detalle'

function linea(over: Partial<LineaConNino> & Pick<LineaConNino, 'id'>): LineaConNino {
  return {
    ninoId: null,
    descripcion: 'Concepto',
    cantidad: 1,
    precioUnitarioCentimos: 0,
    importeCentimos: 0,
    ...over,
  }
}

const nombres = new Map<string, string>([
  ['nino-b', 'Bruno'],
  ['nino-a', 'Ana'],
])

describe('agruparLineasPorHijo', () => {
  it('agrupa por hijo, ordena los grupos por nombre y separa el bloque familiar', () => {
    const lineas: LineaConNino[] = [
      linea({ id: 'l1', ninoId: 'nino-b', descripcion: 'Cuota Bruno', importeCentimos: 20000 }),
      linea({ id: 'l2', ninoId: 'nino-a', descripcion: 'Cuota Ana', importeCentimos: 20000 }),
      linea({ id: 'l3', ninoId: null, descripcion: 'Descuento hermanos', importeCentimos: -5000 }),
      linea({ id: 'l4', ninoId: null, descripcion: 'Saldo a favor', importeCentimos: -1000 }),
    ]

    const r = agruparLineasPorHijo(lineas, nombres)

    // Grupos ordenados por nombre: Ana antes que Bruno.
    expect(r.gruposHijo.map((g) => g.ninoNombre)).toEqual(['Ana', 'Bruno'])
    expect(r.gruposHijo[0].ninoId).toBe('nino-a')
    expect(r.gruposHijo[0].lineas.map((l) => l.id)).toEqual(['l2'])
    expect(r.gruposHijo[0].subtotalCentimos).toBe(20000)
    // Las familiares van aparte, con su subtotal (negativo).
    expect(r.lineasFamiliares.map((l) => l.id)).toEqual(['l3', 'l4'])
    expect(r.subtotalFamiliarCentimos).toBe(-6000)
  })

  it('dentro de un hijo pone las positivas antes que las negativas', () => {
    const lineas: LineaConNino[] = [
      linea({ id: 'neg', ninoId: 'nino-a', descripcion: 'Beca', importeCentimos: -3000 }),
      linea({ id: 'pos', ninoId: 'nino-a', descripcion: 'Cuota', importeCentimos: 20000 }),
    ]

    const r = agruparLineasPorHijo(lineas, nombres)

    expect(r.gruposHijo).toHaveLength(1)
    expect(r.gruposHijo[0].lineas.map((l) => l.id)).toEqual(['pos', 'neg'])
    expect(r.gruposHijo[0].subtotalCentimos).toBe(17000)
  })

  it('sin líneas familiares deja el bloque familiar vacío y subtotal 0', () => {
    const r = agruparLineasPorHijo(
      [linea({ id: 'l1', ninoId: 'nino-a', importeCentimos: 100 })],
      nombres
    )
    expect(r.lineasFamiliares).toEqual([])
    expect(r.subtotalFamiliarCentimos).toBe(0)
  })

  it('cae al ninoId cuando falta el nombre del hijo', () => {
    const r = agruparLineasPorHijo(
      [linea({ id: 'l1', ninoId: 'nino-desconocido', importeCentimos: 100 })],
      nombres
    )
    expect(r.gruposHijo[0].ninoNombre).toBe('nino-desconocido')
  })
})
