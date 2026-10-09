import { describe, expect, it } from 'vitest'

import {
  agruparRecorridoFamilia,
  etiquetaRecorrido,
  type RecorridoTramo,
} from '../recorrido-familia'

function tramo(over: Partial<RecorridoTramo> = {}): RecorridoTramo {
  return {
    id: 'm1',
    aula_nombre: 'Sala Bebés',
    curso_id: 'c1',
    curso_nombre: '2023-24',
    curso_fecha_inicio: '2023-09-01',
    fecha_alta: '2023-09-01',
    fecha_baja: null,
    estado: 'activa',
    ...over,
  }
}

describe('etiquetaRecorrido — solo «En curso» / «Terminado»', () => {
  it('activa y abierta → en_curso', () => {
    expect(etiquetaRecorrido(tramo())).toBe('en_curso')
  })

  it('activa con fecha_baja → terminado', () => {
    expect(etiquetaRecorrido(tramo({ fecha_baja: '2024-07-31' }))).toBe('terminado')
  })

  it('baja (pase de curso, fin de etapa o baja intra-curso) → terminado', () => {
    expect(etiquetaRecorrido(tramo({ estado: 'baja', fecha_baja: '2024-07-31' }))).toBe('terminado')
  })
})

describe('agruparRecorridoFamilia', () => {
  it('agrupa por curso, el más reciente primero', () => {
    const grupos = agruparRecorridoFamilia([
      tramo({ id: 'a', curso_id: 'c1', curso_nombre: '2023-24', estado: 'baja' }),
      tramo({
        id: 'b',
        curso_id: 'c2',
        curso_nombre: '2024-25',
        curso_fecha_inicio: '2024-09-01',
        fecha_alta: '2024-09-01',
      }),
    ])
    expect(grupos.map((g) => g.curso_nombre)).toEqual(['2024-25', '2023-24'])
  })

  it('no enseña altas a medias aunque llegasen (pendiente/lista)', () => {
    const colados = [
      tramo({ id: 'p', estado: 'pendiente' as RecorridoTramo['estado'] }),
      tramo({ id: 'l', estado: 'lista' as RecorridoTramo['estado'] }),
      tramo({ id: 'ok', estado: 'activa' }),
    ]
    const grupos = agruparRecorridoFamilia(colados)
    expect(grupos.flatMap((g) => g.tramos.map((t) => t.id))).toEqual(['ok'])
  })

  it('sin tramos visibles → vacío', () => {
    expect(
      agruparRecorridoFamilia([tramo({ estado: 'pendiente' as RecorridoTramo['estado'] })])
    ).toEqual([])
  })
})
