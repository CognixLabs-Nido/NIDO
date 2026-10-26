import { describe, expect, it } from 'vitest'

import {
  construirHistorial,
  type EnlaceRemesaInput,
  type LineaEnlazadaInput,
  type ReciboHistorialInput,
  type SobranteChequeInput,
} from '../historial-familia'

/**
 * F-6 — el histórico de recibos de una familia. Las formas de las filas son las que dejan en la BD
 * las funciones de cobro (`resolver_devolucion`, `cobrar_recibo_con_cheque`,
 * `resolver_sobrante_cheque`); el RLS `historial-recibos-familia` las crea por esas funciones.
 */

function recibo(id: string, over: Partial<ReciboHistorialInput> = {}): ReciboHistorialInput {
  return {
    id,
    familia_id: 'fam',
    anio: 2026,
    mes: 3,
    estado: 'pendiente_procesar',
    metodo: 'sepa',
    total_centimos: 30000,
    es_esporadico: false,
    concepto_esporadico: null,
    devuelto_de_recibo_id: null,
    diferencia_de_recibo_id: null,
    fecha_envio_banco: null,
    fecha_devolucion: null,
    devolucion_gastos_centimos: null,
    devolucion_salida: null,
    cobro_forma: null,
    cobro_fecha: null,
    cobro_nota: null,
    cobro_importe_centimos: null,
    created_at: '2026-03-01T10:00:00Z',
    ...over,
  }
}

function historial(
  recibos: ReciboHistorialInput[],
  extra: {
    enlacesRemesa?: EnlaceRemesaInput[]
    lineasEnlazadas?: LineaEnlazadaInput[]
    sobrantes?: SobranteChequeInput[]
  } = {}
) {
  return construirHistorial({
    recibos,
    enlacesRemesa: extra.enlacesRemesa ?? [],
    lineasEnlazadas: extra.lineasEnlazadas ?? [],
    sobrantes: extra.sobrantes ?? [],
  })
}

const uno = (...args: Parameters<typeof historial>) => {
  const filas = historial(...args)
  return (id: string) => filas.find((f) => f.id === id)!
}

describe('construirHistorial — el estado que se enseña', () => {
  it('borrador, validado, enviado al banco, devuelto y cobrado', () => {
    const f = uno([
      recibo('b', { estado: 'borrador' }),
      recibo('v'),
      recibo('e', { estado: 'enviado_banco', fecha_envio_banco: '2026-03-05' }),
      recibo('d', { estado: 'devuelto', fecha_devolucion: '2026-03-20' }),
      recibo('c', { estado: 'cobrado_manual', metodo: 'efectivo', cobro_forma: 'efectivo' }),
    ])
    expect(f('b').estado).toBe('borrador')
    expect(f('v').estado).toBe('validado')
    expect(f('e').estado).toBe('enviado_banco')
    expect(f('e').fechaEnvioBanco).toBe('2026-03-05')
    expect(f('d').estado).toBe('devuelto')
    expect(f('c').estado).toBe('cobrado')
  })

  it('un validado en una remesa viva sale «en remesa», con el mes de la remesa y si se envió', () => {
    const f = uno([recibo('r1'), recibo('r2'), recibo('libre')], {
      enlacesRemesa: [
        { reciboId: 'r1', anio: 2026, mes: 3, estado: 'borrador' },
        { reciboId: 'r2', anio: 2026, mes: 3, estado: 'enviada' },
      ],
    })
    expect(f('r1')).toMatchObject({
      estado: 'en_remesa',
      remesa: { anio: 2026, mes: 3, enviada: false },
    })
    expect(f('r2').remesa?.enviada).toBe(true)
    // Sin enlace a una remesa viva (la query no pasa las borradas), sigue validado.
    expect(f('libre')).toMatchObject({ estado: 'validado', remesa: null })
  })
})

describe('construirHistorial — las devoluciones y sus cuatro salidas', () => {
  it('sin resolver: devuelto, con lo que se debe (recibo + gastos)', () => {
    const f = uno([
      recibo('d', {
        estado: 'devuelto',
        fecha_devolucion: '2026-03-20',
        devolucion_gastos_centimos: 350,
      }),
    ])
    expect(f('d')).toMatchObject({
      estado: 'devuelto',
      cobro: null,
      devolucion: {
        fecha: '2026-03-20',
        gastosCentimos: 350,
        importeCentimos: 30350,
        salida: null,
        llevadaA: null,
      },
    })
  })

  it('banco: sigue devuelto y enlaza el re-giro; el re-giro enlaza su origen', () => {
    const f = uno([
      recibo('d', {
        estado: 'devuelto',
        fecha_devolucion: '2026-03-20',
        devolucion_salida: 'banco',
      }),
      recibo('rg', {
        es_esporadico: true,
        concepto_esporadico: 'Re-giro',
        devuelto_de_recibo_id: 'd',
        created_at: '2026-03-21T10:00:00Z',
      }),
    ])
    expect(f('d').devolucion).toMatchObject({
      salida: 'banco',
      llevadaA: { reciboId: 'rg', anio: 2026, mes: 3 },
    })
    expect(f('rg')).toMatchObject({
      tipo: 'regiro',
      origen: { reciboId: 'd', anio: 2026, mes: 3 },
    })
  })

  it('siguiente recibo: sigue devuelto y enlaza el del mes siguiente, que dice qué incluye', () => {
    const f = uno(
      [
        recibo('d', {
          estado: 'devuelto',
          fecha_devolucion: '2026-03-20',
          devolucion_gastos_centimos: 200,
          devolucion_salida: 'siguiente_recibo',
        }),
        recibo('abr', { mes: 4, estado: 'borrador', total_centimos: 60200 }),
      ],
      {
        lineasEnlazadas: [
          {
            reciboId: 'abr',
            importeCentimos: 30200,
            arrastreDeReciboId: 'd',
            sobranteDeDesbordeId: null,
          },
        ],
      }
    )
    expect(f('d')).toMatchObject({
      estado: 'devuelto',
      devolucion: { salida: 'siguiente_recibo', llevadaA: { reciboId: 'abr', mes: 4 } },
    })
    expect(f('abr').incluye).toEqual([
      { reciboId: 'd', anio: 2026, mes: 3, tipo: 'devolucion', importeCentimos: 30200 },
    ])
  })

  it('efectivo o transferencia: queda cobrado, sin dejar de decir que fue una devolución', () => {
    const f = uno([
      recibo('d', {
        estado: 'cobrado_manual',
        fecha_envio_banco: '2026-03-05',
        fecha_devolucion: '2026-03-20',
        devolucion_gastos_centimos: 300,
        devolucion_salida: 'transferencia',
        cobro_forma: 'transferencia',
        cobro_fecha: '2026-03-25',
      }),
    ])
    expect(f('d')).toMatchObject({
      estado: 'cobrado',
      fechaEnvioBanco: '2026-03-05',
      cobro: { forma: 'transferencia', fecha: '2026-03-25', chequeCentimos: null },
      devolucion: { salida: 'transferencia', importeCentimos: 30300, llevadaA: null },
    })
  })
})

describe('construirHistorial — el cheque, su diferencia y su sobrante', () => {
  it('cheque menor: cobrado con el importe del cheque y la diferencia enlazada en los dos sentidos', () => {
    const f = uno([
      recibo('ch', {
        estado: 'cobrado_manual',
        metodo: 'cheque_guarderia',
        cobro_forma: 'cheque_guarderia',
        cobro_fecha: '2026-03-10',
        cobro_importe_centimos: 20000,
      }),
      recibo('dif', {
        es_esporadico: true,
        concepto_esporadico: 'Diferencia cheque',
        total_centimos: 10000,
        diferencia_de_recibo_id: 'ch',
        created_at: '2026-03-10T11:00:00Z',
      }),
    ])
    expect(f('ch')).toMatchObject({
      estado: 'cobrado',
      cobro: { forma: 'cheque_guarderia', chequeCentimos: 20000 },
      diferencia: { reciboId: 'dif', totalCentimos: 10000 },
      sobrante: null,
    })
    expect(f('dif')).toMatchObject({ tipo: 'diferencia_cheque', origen: { reciboId: 'ch' } })
  })

  it('cheque mayor: el sobrante pendiente, devuelto por transferencia o diferido al recibo siguiente', () => {
    const cheque = (id: string) =>
      recibo(id, {
        estado: 'cobrado_manual',
        metodo: 'cheque_guarderia',
        cobro_forma: 'cheque_guarderia',
        cobro_importe_centimos: 31000,
      })
    const f = uno([cheque('pend'), cheque('trans'), cheque('dif'), recibo('abr', { mes: 4 })], {
      sobrantes: [
        { id: 's1', reciboId: 'pend', excesoCentimos: 1000, estado: 'pendiente', via: null },
        {
          id: 's2',
          reciboId: 'trans',
          excesoCentimos: 1000,
          estado: 'resuelto',
          via: 'transferencia',
        },
        { id: 's3', reciboId: 'dif', excesoCentimos: 1000, estado: 'resuelto', via: 'reducir' },
      ],
      lineasEnlazadas: [
        {
          reciboId: 'abr',
          importeCentimos: -1000,
          arrastreDeReciboId: null,
          sobranteDeDesbordeId: 's3',
        },
      ],
    })
    expect(f('pend').sobrante).toEqual({ excesoCentimos: 1000, resueltoPor: null, diferidoA: null })
    expect(f('trans').sobrante).toMatchObject({ resueltoPor: 'transferencia', diferidoA: null })
    expect(f('dif').sobrante).toMatchObject({
      resueltoPor: 'diferir',
      diferidoA: { reciboId: 'abr', mes: 4 },
    })
    expect(f('abr').incluye).toEqual([
      { reciboId: 'dif', anio: 2026, mes: 3, tipo: 'sobrante', importeCentimos: -1000 },
    ])
  })
})

describe('construirHistorial — enlaces y orden', () => {
  it('un enlace que apunta fuera de los recibos de la familia no se inventa', () => {
    const f = uno(
      [
        recibo('rg', { es_esporadico: true, devuelto_de_recibo_id: 'otro' }),
        recibo('d', { estado: 'devuelto', devolucion_salida: 'siguiente_recibo' }),
      ],
      {
        lineasEnlazadas: [
          {
            reciboId: 'rg',
            importeCentimos: 100,
            arrastreDeReciboId: 'ajeno',
            sobranteDeDesbordeId: null,
          },
        ],
      }
    )
    expect(f('rg').origen).toBeNull()
    expect(f('rg').incluye).toEqual([])
    expect(f('d').devolucion?.llevadaA).toBeNull()
  })

  it('el más reciente arriba; en el mismo mes, el mensual antes que los esporádicos', () => {
    const ids = historial([
      recibo('ene', { mes: 1 }),
      recibo('mar-esp-viejo', { es_esporadico: true, created_at: '2026-03-02T00:00:00Z' }),
      recibo('mar-esp-nuevo', { es_esporadico: true, created_at: '2026-03-09T00:00:00Z' }),
      recibo('mar', { created_at: '2026-03-15T00:00:00Z' }),
      recibo('dic-ant', { anio: 2025, mes: 12 }),
    ]).map((r) => r.id)
    expect(ids).toEqual(['mar', 'mar-esp-nuevo', 'mar-esp-viejo', 'ene', 'dic-ant'])
  })
})
