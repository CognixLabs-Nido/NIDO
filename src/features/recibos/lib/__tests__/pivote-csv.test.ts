import { describe, expect, it } from 'vitest'

import type { PivoteRecibos } from '../pivote'
import { centimosACsv, pivoteACsvFilas, type TextosPivoteCsv } from '../pivote-csv'

const textos: TextosPivoteCsv = {
  tutor: 'Tutor',
  nino: 'Niño',
  estado: 'Estado',
  metodo: 'Método',
  total: 'Total',
  totalesFila: 'Totales',
  sinMetodo: 'Sin método',
  estadoLabel: (e) => `E:${e}`,
  metodoLabel: (m) => `M:${m}`,
}

const pivote: PivoteRecibos = {
  columnas: [
    { key: 'c-comedor', label: 'Comedor' },
    { key: 'desc:Beca', label: 'Beca' },
  ],
  filas: [
    {
      reciboId: 'r1',
      tutorNombre: 'Ana',
      ninoNombre: 'Beto',
      estado: 'pendiente_procesar',
      metodo: 'sepa',
      esEsporadico: false,
      esRegiro: false,
      celdas: { 'c-comedor': 5000, 'desc:Beca': -1500 },
      totalCentimos: 3500,
    },
    {
      reciboId: 'r2',
      tutorNombre: 'Cris',
      ninoNombre: 'Dani',
      estado: 'enviado_banco',
      metodo: null,
      esEsporadico: false,
      esRegiro: false,
      celdas: { 'c-comedor': 2000 },
      totalCentimos: 2000,
    },
  ],
  totalesColumna: { 'c-comedor': 7000, 'desc:Beca': -1500 },
  totalGeneral: 5500,
}

describe('centimosACsv', () => {
  it('formatea con coma decimal y respeta el signo', () => {
    expect(centimosACsv(5000)).toBe('50,00')
    expect(centimosACsv(-1500)).toBe('-15,00')
    expect(centimosACsv(0)).toBe('0,00')
  })
})

describe('pivoteACsvFilas', () => {
  it('cabecera = fijas + columnas + total', () => {
    const filas = pivoteACsvFilas(pivote, textos)
    expect(filas[0]).toEqual(['Tutor', 'Niño', 'Estado', 'Método', 'Comedor', 'Beca', 'Total'])
  })

  it('fila de recibo con método y celda ausente en blanco', () => {
    const filas = pivoteACsvFilas(pivote, textos)
    expect(filas[1]).toEqual([
      'Ana',
      'Beto',
      'E:pendiente_procesar',
      'M:sepa',
      '50,00',
      '-15,00',
      '35,00',
    ])
    // r2 no tiene columna Beca → celda en blanco; método nulo → sinMetodo.
    expect(filas[2]).toEqual([
      'Cris',
      'Dani',
      'E:enviado_banco',
      'Sin método',
      '20,00',
      '',
      '20,00',
    ])
  })

  it('última fila = totales por columna y total general', () => {
    const filas = pivoteACsvFilas(pivote, textos)
    expect(filas[filas.length - 1]).toEqual(['Totales', '', '', '', '70,00', '-15,00', '55,00'])
  })
})
