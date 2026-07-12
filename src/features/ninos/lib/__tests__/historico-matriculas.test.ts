import { describe, expect, it } from 'vitest'

import {
  agruparHistoricoPorCurso,
  etiquetaEstadoTramo,
  MOTIVO_FIN_ETAPA,
  MOTIVO_PASA_CURSO,
  type HistoricoTramo,
} from '../historico-matriculas'

/** Fábrica de tramos con defaults; se sobrescribe lo relevante por test. */
function tramo(over: Partial<HistoricoTramo> = {}): HistoricoTramo {
  return {
    id: 'm1',
    aula_id: 'a1',
    aula_nombre: 'Sala Bebés',
    curso_id: 'c1',
    curso_nombre: '2023-24',
    curso_fecha_inicio: '2023-09-01',
    fecha_alta: '2023-09-01',
    fecha_baja: null,
    motivo_baja: null,
    estado: 'activa',
    ...over,
  }
}

describe('etiquetaEstadoTramo — estado + motivo → etiqueta', () => {
  it("activa sin fecha_baja → 'en_curso'", () => {
    expect(etiquetaEstadoTramo(tramo({ estado: 'activa', fecha_baja: null }))).toEqual({
      tipo: 'en_curso',
    })
  })

  it("activa con fecha_baja → 'activa'", () => {
    expect(etiquetaEstadoTramo(tramo({ estado: 'activa', fecha_baja: '2024-07-31' }))).toEqual({
      tipo: 'activa',
    })
  })

  it("baja con motivo 'pasa de curso' → 'paso_curso'", () => {
    expect(
      etiquetaEstadoTramo(
        tramo({ estado: 'baja', fecha_baja: '2024-07-31', motivo_baja: MOTIVO_PASA_CURSO })
      )
    ).toEqual({ tipo: 'paso_curso' })
  })

  it("baja con motivo 'fin de etapa (no continúa)' → 'finalizo_etapa'", () => {
    expect(
      etiquetaEstadoTramo(
        tramo({ estado: 'baja', fecha_baja: '2024-07-31', motivo_baja: MOTIVO_FIN_ETAPA })
      )
    ).toEqual({ tipo: 'finalizo_etapa' })
  })

  it("baja con motivo libre → 'baja_motivo' con el motivo (trim)", () => {
    expect(
      etiquetaEstadoTramo(
        tramo({ estado: 'baja', fecha_baja: '2024-03-10', motivo_baja: '  cambio de ciudad  ' })
      )
    ).toEqual({ tipo: 'baja_motivo', motivo: 'cambio de ciudad' })
  })

  it("baja sin motivo → 'baja_sin_motivo'", () => {
    expect(
      etiquetaEstadoTramo(tramo({ estado: 'baja', fecha_baja: '2024-03-10', motivo_baja: null }))
    ).toEqual({ tipo: 'baja_sin_motivo' })
  })

  it("pendiente → 'pendiente'; lista → 'validar'", () => {
    expect(etiquetaEstadoTramo(tramo({ estado: 'pendiente' }))).toEqual({ tipo: 'pendiente' })
    expect(etiquetaEstadoTramo(tramo({ estado: 'lista' }))).toEqual({ tipo: 'validar' })
  })
})

describe('agruparHistoricoPorCurso — agrupa por curso y ordena', () => {
  it('agrupa por curso, cursos por fecha_inicio DESC, tramos por fecha_alta ASC', () => {
    // 2023-24 con un tramo; 2024-25 con DOS tramos (baja intra-curso + reincorporación).
    const tramos: HistoricoTramo[] = [
      tramo({
        id: 'r-react',
        curso_id: 'c2',
        curso_nombre: '2024-25',
        curso_fecha_inicio: '2024-09-01',
        fecha_alta: '2025-02-01',
        estado: 'activa',
        aula_nombre: 'Sala 1-2 (reincorp)',
      }),
      tramo({
        id: 'a-viejo',
        curso_id: 'c1',
        curso_nombre: '2023-24',
        curso_fecha_inicio: '2023-09-01',
        fecha_alta: '2023-09-01',
        estado: 'baja',
        fecha_baja: '2024-07-31',
        motivo_baja: MOTIVO_PASA_CURSO,
      }),
      tramo({
        id: 'b-baja',
        curso_id: 'c2',
        curso_nombre: '2024-25',
        curso_fecha_inicio: '2024-09-01',
        fecha_alta: '2024-09-01',
        estado: 'baja',
        fecha_baja: '2025-01-15',
        motivo_baja: 'mudanza',
        aula_nombre: 'Sala 1-2',
      }),
    ]

    const grupos = agruparHistoricoPorCurso(tramos)

    // 2 cursos, el más reciente (2024-25) primero.
    expect(grupos.map((g) => g.curso_nombre)).toEqual(['2024-25', '2023-24'])
    // El curso 2024-25 tiene 2 tramos ordenados por fecha_alta ASC (baja antes que reincorporación).
    expect(grupos[0]?.tramos.map((t) => t.id)).toEqual(['b-baja', 'r-react'])
    // El curso 2023-24 tiene 1 tramo.
    expect(grupos[1]?.tramos.map((t) => t.id)).toEqual(['a-viejo'])
  })

  it('no muta la entrada y devuelve [] para lista vacía', () => {
    const entrada: HistoricoTramo[] = [
      tramo({ id: 'x' }),
      tramo({ id: 'y', fecha_alta: '2023-01-01' }),
    ]
    const copia = JSON.parse(JSON.stringify(entrada))
    agruparHistoricoPorCurso(entrada)
    expect(entrada).toEqual(copia)
    expect(agruparHistoricoPorCurso([])).toEqual([])
  })
})
