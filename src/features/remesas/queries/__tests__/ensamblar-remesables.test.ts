import { describe, expect, it } from 'vitest'

import { ensamblarRemesables, type ReciboSepaRow } from '../get-recibos-sepa-remesables'

/**
 * F-4-5: ensamblado puro de remesables a grano FAMILIA. Excluye los ya enlazados a una
 * remesa, adjunta etiqueta/tutores y marca si la familia tiene mandato activo.
 */

const rows: ReciboSepaRow[] = [
  { id: 'rec-a', familiaId: 'fam-1', totalCentimos: 10000, esEsporadico: false },
  { id: 'rec-b', familiaId: 'fam-2', totalCentimos: 5000, esEsporadico: true },
  { id: 'rec-c', familiaId: 'fam-3', totalCentimos: 4000, esEsporadico: false },
]
const etiquetas = new Map([
  ['fam-1', 'García'],
  ['fam-2', 'Pérez'],
  ['fam-3', 'Álvarez'],
])
const tutores = new Map([['fam-1', ['Ana García', 'Luis Ruiz']]])

describe('ensamblarRemesables', () => {
  it('adjunta etiqueta, tutores y mandato; ordena por etiqueta (es-ES)', () => {
    const out = ensamblarRemesables(
      rows,
      new Set(), // ninguno remesado
      new Set(['fam-1', 'fam-3']), // fam-2 sin mandato
      etiquetas,
      tutores
    )
    expect(out.map((r) => r.familiaEtiqueta)).toEqual(['Álvarez', 'García', 'Pérez'])
    const garcia = out.find((r) => r.familiaId === 'fam-1')!
    expect(garcia.tutores).toEqual(['Ana García', 'Luis Ruiz'])
    expect(garcia.tieneMandato).toBe(true)
    expect(out.find((r) => r.familiaId === 'fam-2')!.tieneMandato).toBe(false)
  })

  it('excluye los recibos ya enlazados a una remesa', () => {
    const out = ensamblarRemesables(rows, new Set(['rec-a']), new Set(), etiquetas, tutores)
    expect(out.map((r) => r.id)).not.toContain('rec-a')
    expect(out).toHaveLength(2)
  })

  it('conserva el importe y el flag esporádico por recibo', () => {
    const out = ensamblarRemesables(rows, new Set(), new Set(), etiquetas, tutores)
    const b = out.find((r) => r.id === 'rec-b')!
    expect(b.totalCentimos).toBe(5000)
    expect(b.esEsporadico).toBe(true)
  })
})
