import { describe, expect, it } from 'vitest'

import {
  construirPivote,
  type LineaPivoteInput,
  type PivoteMaps,
  type ReciboPivoteInput,
} from '../pivote'

const maps: PivoteMaps = {
  ninoNombre: new Map([
    ['n1', 'Ana Niño'],
    ['n2', 'Beto Niño'],
  ]),
  tutorNombre: new Map([
    ['n1', 'Zoe Tutor'],
    ['n2', 'Ana Tutor'],
  ]),
  conceptoNombre: new Map([
    ['c-comedor', 'Comedor'],
    ['c-matinera', 'Matinera'],
  ]),
}

const recibos: ReciboPivoteInput[] = [
  {
    id: 'r1',
    ninoId: 'n1',
    estado: 'pendiente_procesar',
    metodo: 'sepa',
    totalCentimos: 5500,
    esEsporadico: false,
    esRegiro: false,
  },
  {
    id: 'r2',
    ninoId: 'n2',
    estado: 'enviado_banco',
    metodo: null,
    totalCentimos: 2000,
    esEsporadico: false,
    esRegiro: false,
  },
]

const lineas: LineaPivoteInput[] = [
  // r1: comedor + matinera + beca (sin concepto, importe negativo)
  {
    reciboId: 'r1',
    conceptoId: 'c-comedor',
    descripcion: 'Comedor (10 días)',
    importeCentimos: 5000,
  },
  { reciboId: 'r1', conceptoId: 'c-matinera', descripcion: 'Matinera', importeCentimos: 2000 },
  { reciboId: 'r1', conceptoId: null, descripcion: 'Beca: Conselleria', importeCentimos: -1500 },
  // r2: solo matinera
  { reciboId: 'r2', conceptoId: 'c-matinera', descripcion: 'Matinera', importeCentimos: 2000 },
]

describe('construirPivote', () => {
  it('agrupa columnas por concepto (nombre del catálogo) y por descripción si no hay concepto', () => {
    const p = construirPivote(recibos, lineas, maps)
    const labels = p.columnas.map((c) => c.label)
    // Ordenadas por etiqueta (es-ES): Beca: Conselleria, Comedor, Matinera
    expect(labels).toEqual(['Beca: Conselleria', 'Comedor', 'Matinera'])
    // La columna de comedor usa el nombre del catálogo, no la descripción "(10 días)".
    expect(p.columnas.find((c) => c.key === 'c-comedor')?.label).toBe('Comedor')
    // La beca (sin concepto) usa clave desc: y su descripción.
    expect(p.columnas.some((c) => c.key === 'desc:Beca: Conselleria')).toBe(true)
  })

  it('rellena celdas por (recibo, columna) sumando importes y deja el total congelado del recibo', () => {
    const p = construirPivote(recibos, lineas, maps)
    const r1 = p.filas.find((f) => f.reciboId === 'r1')!
    expect(r1.celdas['c-comedor']).toBe(5000)
    expect(r1.celdas['c-matinera']).toBe(2000)
    expect(r1.celdas['desc:Beca: Conselleria']).toBe(-1500)
    // El total de fila es el total_centimos del recibo (fuente de verdad), no la suma.
    expect(r1.totalCentimos).toBe(5500)
  })

  it('ordena filas por tutor → niño y expone tutor/niño resueltos', () => {
    const p = construirPivote(recibos, lineas, maps)
    // "Ana Tutor" (r2) va antes que "Zoe Tutor" (r1).
    expect(p.filas.map((f) => f.reciboId)).toEqual(['r2', 'r1'])
    expect(p.filas[0].tutorNombre).toBe('Ana Tutor')
    expect(p.filas[0].ninoNombre).toBe('Beto Niño')
  })

  it('calcula totales por columna y total general', () => {
    const p = construirPivote(recibos, lineas, maps)
    expect(p.totalesColumna['c-matinera']).toBe(4000) // 2000 + 2000
    expect(p.totalesColumna['c-comedor']).toBe(5000)
    expect(p.totalesColumna['desc:Beca: Conselleria']).toBe(-1500)
    expect(p.totalGeneral).toBe(7500) // 5500 + 2000
  })

  it('celda ausente = sin línea en esa columna (undefined, no 0)', () => {
    const p = construirPivote(recibos, lineas, maps)
    const r2 = p.filas.find((f) => f.reciboId === 'r2')!
    expect(r2.celdas['c-comedor']).toBeUndefined()
  })

  it('sin recibos → pivote vacía', () => {
    const p = construirPivote([], [], maps)
    expect(p.columnas).toEqual([])
    expect(p.filas).toEqual([])
    expect(p.totalGeneral).toBe(0)
  })
})
