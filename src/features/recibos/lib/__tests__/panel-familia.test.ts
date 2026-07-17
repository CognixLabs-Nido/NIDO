import { describe, expect, it } from 'vitest'

import {
  construirPanelFamilia,
  esConfirmado,
  type FamiliaPanelInput,
  type LineaPanelInput,
  type ReciboPanelInput,
} from '../panel-familia'

// Fixtures reutilizables.
const familias: FamiliaPanelInput[] = [
  {
    familiaId: 'fam-garcia',
    etiqueta: 'García Ruiz',
    tutores: ['Ana García', 'Luis Ruiz'],
    hijos: [
      { ninoId: 'nino-lucia', nombre: 'Lucía' },
      { ninoId: 'nino-mateo', nombre: 'Mateo' },
    ],
  },
  {
    familiaId: 'fam-perez',
    etiqueta: 'Pérez',
    tutores: ['Marta Pérez'],
    hijos: [{ ninoId: 'nino-sofia', nombre: 'Sofía' }],
  },
]

describe('construirPanelFamilia', () => {
  it('agrupa 1 recibo por familia con cargos, descuentos y total congelado', () => {
    const recibos: ReciboPanelInput[] = [
      {
        id: 'rec-garcia',
        familiaId: 'fam-garcia',
        estado: 'borrador',
        metodo: 'sepa',
        totalCentimos: 38000,
      },
    ]
    const lineas: LineaPanelInput[] = [
      linea('l1', 'rec-garcia', 'nino-lucia', 'Cuota mensual', 20000),
      linea('l2', 'rec-garcia', 'nino-mateo', 'Cuota mensual', 20000),
      linea('l3', 'rec-garcia', null, 'Descuento hermanos', -2000),
    ]

    const { filas, indicadores } = construirPanelFamilia(familias, recibos, lineas)

    const garcia = filas.find((f) => f.familiaId === 'fam-garcia')!
    expect(garcia.recibo).not.toBeNull()
    expect(garcia.recibo!.cargosCentimos).toBe(40000) // 20000 + 20000
    expect(garcia.recibo!.descuentosCentimos).toBe(-2000) // solo la negativa
    expect(garcia.recibo!.totalCentimos).toBe(38000) // congelado del recibo, no recomputado
    expect(indicadores.numRecibos).toBe(1)
    expect(indicadores.totalCentimos).toBe(38000)
  })

  it('resuelve el nombre del hijo en líneas de hijo y deja null en líneas familiares', () => {
    const recibos: ReciboPanelInput[] = [
      {
        id: 'rec-garcia',
        familiaId: 'fam-garcia',
        estado: 'borrador',
        metodo: 'sepa',
        totalCentimos: 18000,
      },
    ]
    const lineas: LineaPanelInput[] = [
      linea('l1', 'rec-garcia', 'nino-lucia', 'Cuota mensual', 20000),
      linea('l2', 'rec-garcia', null, 'Descuento hermanos', -2000),
    ]

    const { filas } = construirPanelFamilia(familias, recibos, lineas)
    const lineasGarcia = filas.find((f) => f.familiaId === 'fam-garcia')!.recibo!.lineas

    const deHijo = lineasGarcia.find((l) => l.id === 'l1')!
    expect(deHijo.ninoId).toBe('nino-lucia')
    expect(deHijo.ninoNombre).toBe('Lucía')

    const familiar = lineasGarcia.find((l) => l.id === 'l2')!
    expect(familiar.ninoId).toBeNull()
    expect(familiar.ninoNombre).toBeNull()
  })

  it('ordena líneas: hijos (por nombre) antes que familiares; positivas antes que negativas', () => {
    const recibos: ReciboPanelInput[] = [
      {
        id: 'rec-garcia',
        familiaId: 'fam-garcia',
        estado: 'borrador',
        metodo: 'sepa',
        totalCentimos: 0,
      },
    ]
    const lineas: LineaPanelInput[] = [
      linea('fam', 'rec-garcia', null, 'Saldo mes anterior', -1000),
      linea('mateo', 'rec-garcia', 'nino-mateo', 'Cuota', 20000),
      linea('lucia-beca', 'rec-garcia', 'nino-lucia', 'Beca', -5000),
      linea('lucia-cuota', 'rec-garcia', 'nino-lucia', 'Cuota', 20000),
    ]

    const orden = construirPanelFamilia(familias, recibos, lineas)
      .filas.find((f) => f.familiaId === 'fam-garcia')!
      .recibo!.lineas.map((l) => l.id)

    // Lucía (cuota+ luego beca−), Mateo, y por último la familiar.
    expect(orden).toEqual(['lucia-cuota', 'lucia-beca', 'mateo', 'fam'])
  })

  it('familia activa sin recibo → fila con recibo null y cuenta en familiasSinRecibo', () => {
    const recibos: ReciboPanelInput[] = [
      {
        id: 'rec-garcia',
        familiaId: 'fam-garcia',
        estado: 'borrador',
        metodo: 'sepa',
        totalCentimos: 40000,
      },
    ]
    const lineas: LineaPanelInput[] = [linea('l1', 'rec-garcia', 'nino-lucia', 'Cuota', 40000)]

    const { filas, indicadores } = construirPanelFamilia(familias, recibos, lineas)

    const perez = filas.find((f) => f.familiaId === 'fam-perez')!
    expect(perez.recibo).toBeNull()
    expect(indicadores.familiasSinRecibo).toBe(1)
    expect(indicadores.numRecibos).toBe(1)
  })

  it('cuenta confirmados/pendientes por estado (borrador = pendiente)', () => {
    const recibos: ReciboPanelInput[] = [
      {
        id: 'rec-garcia',
        familiaId: 'fam-garcia',
        estado: 'borrador',
        metodo: 'sepa',
        totalCentimos: 100,
      },
      {
        id: 'rec-perez',
        familiaId: 'fam-perez',
        estado: 'pendiente_procesar',
        metodo: 'efectivo',
        totalCentimos: 200,
      },
    ]
    const lineas: LineaPanelInput[] = [
      linea('l1', 'rec-garcia', 'nino-lucia', 'Cuota', 100),
      linea('l2', 'rec-perez', 'nino-sofia', 'Cuota', 200),
    ]

    const { indicadores } = construirPanelFamilia(familias, recibos, lineas)
    expect(indicadores.confirmados).toBe(1) // pendiente_procesar
    expect(indicadores.pendientes).toBe(1) // borrador
    expect(indicadores.totalCentimos).toBe(300)
  })

  it('filas ordenadas por etiqueta de familia (es-ES)', () => {
    const orden = construirPanelFamilia(familias, [], []).filas.map((f) => f.etiqueta)
    expect(orden).toEqual(['García Ruiz', 'Pérez'])
  })

  it('esConfirmado: solo borrador es editable', () => {
    expect(esConfirmado('borrador')).toBe(false)
    expect(esConfirmado('pendiente_procesar')).toBe(true)
    expect(esConfirmado('enviado_banco')).toBe(true)
    expect(esConfirmado('cobrado_manual')).toBe(true)
  })
})

function linea(
  id: string,
  reciboId: string,
  ninoId: string | null,
  descripcion: string,
  importeCentimos: number
): LineaPanelInput {
  return {
    id,
    reciboId,
    ninoId,
    conceptoId: null,
    descripcion,
    cantidad: 1,
    precioUnitarioCentimos: importeCentimos,
    importeCentimos,
  }
}
