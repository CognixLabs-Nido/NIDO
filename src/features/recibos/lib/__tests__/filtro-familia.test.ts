import { describe, expect, it } from 'vitest'

import {
  borradoresVisibles,
  filtrarPanel,
  opcionesFamilia,
  seleccionVisible,
  type EsporadicoFiltrable,
  type FilaFiltrable,
} from '../filtro-familia'

/** F-6 — el filtro por familia del panel del mes de Cuotas. */

const filas: FilaFiltrable[] = [
  { familiaId: 'f-perez', etiqueta: 'Pérez', recibo: { id: 'r-perez', estado: 'borrador' } },
  { familiaId: 'f-abad', etiqueta: 'Abad', recibo: { id: 'r-abad', estado: 'borrador' } },
  { familiaId: 'f-gil', etiqueta: 'Gil', recibo: { id: 'r-gil', estado: 'pendiente_procesar' } },
  { familiaId: 'f-sin', etiqueta: 'Sin recibo', recibo: null },
]
const esporadicos: EsporadicoFiltrable[] = [
  { familiaId: 'f-abad', familiaEtiqueta: 'Abad' },
  // Una familia que solo sale por un esporádico (sin hijos activos este mes).
  { familiaId: 'f-ruiz', familiaEtiqueta: 'Ruiz' },
  { familiaId: null, familiaEtiqueta: '' },
]

describe('filtro por familia', () => {
  it('las opciones son las familias del mes, con fila o con un esporádico, por etiqueta', () => {
    expect(opcionesFamilia(filas, esporadicos).map((o) => o.etiqueta)).toEqual([
      'Abad',
      'Gil',
      'Pérez',
      'Ruiz',
      'Sin recibo',
    ])
  })

  it('sin filtro se ve todo; con filtro, solo las filas y los esporádicos de esa familia', () => {
    expect(filtrarPanel(filas, esporadicos, null)).toEqual({ filas, esporadicos })
    const abad = filtrarPanel(filas, esporadicos, 'f-abad')
    expect(abad.filas.map((f) => f.familiaId)).toEqual(['f-abad'])
    expect(abad.esporadicos.map((e) => e.familiaId)).toEqual(['f-abad'])
    expect(filtrarPanel(filas, esporadicos, 'f-ruiz').filas).toEqual([])
  })

  it('en lote solo se confirma lo marcado que se ve: un borrador escondido por el filtro, no', () => {
    // Premisa: marcados los dos borradores del mes sin filtro.
    const todos = borradoresVisibles(filtrarPanel(filas, esporadicos, null).filas)
    expect(todos).toEqual(['r-perez', 'r-abad'])
    const marcados = new Set(todos)
    // Con el filtro en Abad, el de Pérez sigue marcado pero no se ve: no se confirma.
    const visibles = borradoresVisibles(filtrarPanel(filas, esporadicos, 'f-abad').filas)
    expect(visibles).toEqual(['r-abad'])
    expect(seleccionVisible(marcados, visibles)).toEqual(['r-abad'])
    // Y un recibo validado no es un borrador marcable.
    expect(borradoresVisibles(filtrarPanel(filas, esporadicos, 'f-gil').filas)).toEqual([])
  })
})
