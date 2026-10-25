import { describe, expect, it } from 'vitest'

import {
  arrastreOfrecido,
  cobrableAMano,
  destinoArrastre,
  devolucionPorResolver,
  entraEnGestion,
  formaPorDefecto,
  importeDevolucion,
  mesSiguiente,
  ordenarGestion,
  resueltoPorDe,
  type ReciboGestion,
} from '../gestion-cobros'

/**
 * PR-1a: la gestión enseña lo que espera un cobro a mano (pendientes que no son SEPA) y lo que ya
 * está en el ciclo de cobro. Un SEPA pendiente va por remesa: no sale y no se cobra a mano.
 * PR-2: un devuelto no se cobra a mano: espera su salida, una sola vez, por total + gastos.
 * PR-14: la salida al siguiente recibo va al mes siguiente, sin saltos: al borrador de ese mes, o a un
 * recibo nuevo si no lo tiene; con su recibo ya validado o el mes cerrado sin recibo, no se ofrece.
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
    devolucionGastosCentimos: null,
    devolucionSalida: null,
    arrastre: null,
    arrastradoA: null,
    cobroForma: null,
    cobroFecha: null,
    cobroNota: null,
    cobroImporteCentimos: null,
    esDiferenciaCheque: false,
    familiaConMandato: false,
    sobranteCheque: null,
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
  it('un pendiente que no es SEPA, sí', () => {
    expect(cobrableAMano(recibo({ metodo: 'efectivo' }))).toBe(true)
    expect(cobrableAMano(recibo({ metodo: null }))).toBe(true)
  })

  it('un devuelto (PR-2), un SEPA pendiente, un enviado y uno ya cobrado, no', () => {
    expect(cobrableAMano(recibo({ estado: 'devuelto', metodo: 'sepa' }))).toBe(false)
    expect(cobrableAMano(recibo({ metodo: 'sepa' }))).toBe(false)
    expect(cobrableAMano(recibo({ estado: 'enviado_banco', metodo: 'sepa' }))).toBe(false)
    expect(cobrableAMano(recibo({ estado: 'cobrado_manual' }))).toBe(false)
  })
})

describe('formaPorDefecto', () => {
  it('propone la forma del método cuando se cobra a mano (transferencia o cheque); si no, efectivo', () => {
    expect(formaPorDefecto({ metodo: 'transferencia' })).toBe('transferencia')
    expect(formaPorDefecto({ metodo: 'cheque_guarderia' })).toBe('cheque_guarderia')
    expect(formaPorDefecto({ metodo: 'efectivo' })).toBe('efectivo')
    expect(formaPorDefecto({ metodo: null })).toBe('efectivo')
    // No hay forma «sepa».
    expect(formaPorDefecto({ metodo: 'sepa' })).toBe('efectivo')
  })
})

describe('devolución (PR-2)', () => {
  it('espera su salida solo un devuelto sin resolver', () => {
    expect(devolucionPorResolver(recibo({ estado: 'devuelto' }))).toBe(true)
    expect(devolucionPorResolver(recibo({ estado: 'devuelto', devolucionSalida: 'banco' }))).toBe(
      false
    )
    expect(
      devolucionPorResolver(recibo({ estado: 'cobrado_manual', devolucionSalida: 'efectivo' }))
    ).toBe(false)
    expect(devolucionPorResolver(recibo({ estado: 'enviado_banco' }))).toBe(false)
  })

  it('la salida cobra el recibo más los gastos', () => {
    expect(importeDevolucion(recibo({ totalCentimos: 10000, devolucionGastosCentimos: 350 }))).toBe(
      10350
    )
    expect(importeDevolucion(recibo({ totalCentimos: 10000, devolucionGastosCentimos: 0 }))).toBe(
      10000
    )
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

  it('un devuelto ya resuelto por el banco no pide nada: va con los cobrados', () => {
    const orden = ordenarGestion([
      recibo({
        id: 'resuelto',
        estado: 'devuelto',
        devolucionSalida: 'banco',
        familiaEtiqueta: 'A',
      }),
      recibo({ id: 'enviado', estado: 'enviado_banco', familiaEtiqueta: 'B' }),
      recibo({ id: 'pendiente', estado: 'devuelto', familiaEtiqueta: 'C' }),
    ]).map((r) => r.id)
    expect(orden).toEqual(['pendiente', 'enviado', 'resuelto'])
  })
})

describe('destinoArrastre (PR-14)', () => {
  const devuelto = { anio: 2026, mes: 10 }
  const noviembre = { anio: 2026, mes: 11 }

  it('el mes siguiente; diciembre pasa a enero del año siguiente', () => {
    expect(mesSiguiente(devuelto)).toEqual(noviembre)
    expect(mesSiguiente({ anio: 2026, mes: 12 })).toEqual({ anio: 2027, mes: 1 })
    // De junio a julio aunque cambie el curso: sin saltos.
    expect(mesSiguiente({ anio: 2027, mes: 6 })).toEqual({ anio: 2027, mes: 7 })
  })

  it('con el recibo del mes siguiente en borrador, la línea entra en él', () => {
    const d = destinoArrastre(devuelto, { estado: 'borrador' }, false)
    expect(d).toEqual({ mes: noviembre, tipo: 'anadir' })
    expect(arrastreOfrecido(d)).toBe(true)
  })

  it('sin recibo ese mes, se crea; nunca salta a uno posterior', () => {
    const d = destinoArrastre(devuelto, null, false)
    expect(d).toEqual({ mes: noviembre, tipo: 'crear' })
    expect(arrastreOfrecido(d)).toBe(true)
  })

  it('con el recibo del mes siguiente ya validado, no se ofrece, esté o no cerrado el mes', () => {
    for (const estado of [
      'pendiente_procesar',
      'enviado_banco',
      'devuelto',
      'cobrado_manual',
    ] as const) {
      for (const cerrado of [false, true]) {
        const d = destinoArrastre(devuelto, { estado }, cerrado)
        expect(d, `${estado} ${cerrado}`).toEqual({ mes: noviembre, tipo: 'recibo_cerrado' })
        expect(arrastreOfrecido(d)).toBe(false)
      }
    }
  })

  it('sin recibo y con el mes siguiente cerrado, no se ofrece', () => {
    const d = destinoArrastre(devuelto, null, true)
    expect(d).toEqual({ mes: noviembre, tipo: 'mes_cerrado' })
    expect(arrastreOfrecido(d)).toBe(false)
  })

  it('una devolución arrastrada ya está resuelta: no espera salida y va con los cobrados', () => {
    const arrastrada = recibo({
      id: 'a',
      estado: 'devuelto',
      devolucionSalida: 'siguiente_recibo',
      arrastradoA: { anio: 2026, mes: 11 },
    })
    const pendiente = recibo({ id: 'p', estado: 'devuelto' })
    expect(devolucionPorResolver(arrastrada)).toBe(false)
    expect(devolucionPorResolver(pendiente)).toBe(true)
    expect(ordenarGestion([arrastrada, pendiente]).map((r) => r.id)).toEqual(['p', 'a'])
  })
})

describe('resueltoPorDe (PR-1c)', () => {
  it('pendiente es null; resuelto, «diferir» (reducir) o «transferencia»', () => {
    expect(resueltoPorDe({ estado: 'pendiente', via: null })).toBeNull()
    expect(resueltoPorDe({ estado: 'resuelto', via: 'reducir' })).toBe('diferir')
    expect(resueltoPorDe({ estado: 'resuelto', via: 'transferencia' })).toBe('transferencia')
  })
})
