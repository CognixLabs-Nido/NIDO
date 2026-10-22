import { describe, expect, it } from 'vitest'

import {
  cobrableAMano,
  entraEnGestion,
  ordenarGestion,
  type ReciboGestion,
} from '../gestion-cobros'

/**
 * PR-1a: la gestión enseña lo que espera un cobro a mano (pendientes que no son SEPA) y lo que ya
 * está en el ciclo de cobro. Un SEPA pendiente va por remesa: no sale y no se cobra a mano.
 */

function recibo(over: Partial<ReciboGestion>): ReciboGestion {
  return {
    id: 'r',
    familiaEtiqueta: 'Familia',
    totalCentimos: 1000,
    estado: 'pendiente_procesar',
    metodo: 'efectivo',
    esEsporadico: false,
    conceptoEsporadico: null,
    fechaEnvioBanco: null,
    fechaDevolucion: null,
    esRegiro: false,
    cobroForma: null,
    cobroFecha: null,
    cobroNota: null,
    ...over,
  }
}

describe('entraEnGestion', () => {
  it('pendientes: efectivo, transferencia, cheque y sin método entran; SEPA no', () => {
    expect(entraEnGestion({ estado: 'pendiente_procesar', metodo: 'efectivo' })).toBe(true)
    expect(entraEnGestion({ estado: 'pendiente_procesar', metodo: 'transferencia' })).toBe(true)
    expect(entraEnGestion({ estado: 'pendiente_procesar', metodo: 'cheque_guarderia' })).toBe(true)
    expect(entraEnGestion({ estado: 'pendiente_procesar', metodo: null })).toBe(true)
    expect(entraEnGestion({ estado: 'pendiente_procesar', metodo: 'sepa' })).toBe(false)
  })

  it('el ciclo de cobro entra con cualquier método; un borrador nunca', () => {
    for (const estado of ['enviado_banco', 'devuelto', 'cobrado_manual'] as const) {
      expect(entraEnGestion({ estado, metodo: 'sepa' })).toBe(true)
    }
    expect(entraEnGestion({ estado: 'borrador', metodo: 'efectivo' })).toBe(false)
  })
})

describe('cobrableAMano', () => {
  it('un pendiente que no es SEPA y un devuelto, sí', () => {
    expect(cobrableAMano(recibo({ metodo: 'efectivo' }))).toBe(true)
    expect(cobrableAMano(recibo({ metodo: null }))).toBe(true)
    expect(cobrableAMano(recibo({ estado: 'devuelto', metodo: 'sepa' }))).toBe(true)
  })

  it('un SEPA pendiente, un enviado y uno ya cobrado, no', () => {
    expect(cobrableAMano(recibo({ metodo: 'sepa' }))).toBe(false)
    expect(cobrableAMano(recibo({ estado: 'enviado_banco', metodo: 'sepa' }))).toBe(false)
    expect(cobrableAMano(recibo({ estado: 'cobrado_manual' }))).toBe(false)
  })
})

describe('ordenarGestion', () => {
  it('primero lo que pide una acción (pendientes, devueltos) y, dentro, por familia', () => {
    const orden = ordenarGestion([
      recibo({ id: '1', estado: 'cobrado_manual', familiaEtiqueta: 'A' }),
      recibo({ id: '2', estado: 'enviado_banco', familiaEtiqueta: 'A' }),
      recibo({ id: '3', estado: 'devuelto', familiaEtiqueta: 'A' }),
      recibo({ id: '4', estado: 'pendiente_procesar', familiaEtiqueta: 'Zamora' }),
      recibo({ id: '5', estado: 'pendiente_procesar', familiaEtiqueta: 'Álvarez' }),
    ]).map((r) => r.id)
    expect(orden).toEqual(['5', '4', '3', '2', '1'])
  })
})
