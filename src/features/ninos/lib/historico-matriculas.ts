/**
 * F-8 — Histórico del niño (recorrido por aulas/cursos). Lógica PURA (sin acceso a BD ni
 * a next-intl) para agrupar los tramos de matrícula por curso académico y para mapear el
 * par (estado, motivo_baja) a una etiqueta legible. Se aísla aquí para poder testearla en
 * unit sin montar el servidor ni la RLS.
 *
 * Un mismo curso puede tener VARIOS tramos (p. ej. baja intra-curso + reincorporación en el
 * mismo año) — por eso se agrupa en lista de tramos por curso, no una fila por año.
 */

export type MatriculaEstado = 'pendiente' | 'lista' | 'activa' | 'baja'

export interface HistoricoTramo {
  id: string
  aula_id: string
  aula_nombre: string
  curso_id: string
  curso_nombre: string
  /** Fecha de inicio del curso académico — clave de orden cronológico. */
  curso_fecha_inicio: string
  fecha_alta: string
  fecha_baja: string | null
  motivo_baja: string | null
  estado: MatriculaEstado
}

export interface CursoConTramos {
  curso_id: string
  curso_nombre: string
  curso_fecha_inicio: string
  tramos: HistoricoTramo[]
}

/**
 * Literales EXACTOS de `motivo_baja` que escriben las RPC del ciclo de vida (F-3): el
 * rollover que continúa deja `'pasa de curso'` y el que finaliza `'fin de etapa (no
 * continúa)'`. Cualquier otro texto es una baja intra-curso con motivo libre.
 */
export const MOTIVO_PASA_CURSO = 'pasa de curso'
export const MOTIVO_FIN_ETAPA = 'fin de etapa (no continúa)'

/**
 * Descriptor de la etiqueta de estado de un tramo. La UI lo traduce a un literal i18n
 * (`admin.ninos.historico.estado.<tipo>`); `baja_motivo` lleva el motivo crudo como
 * parámetro para interpolarlo ("Baja: {motivo}").
 */
export type EtiquetaTramo =
  | { tipo: 'en_curso' }
  | { tipo: 'activa' }
  | { tipo: 'paso_curso' }
  | { tipo: 'finalizo_etapa' }
  | { tipo: 'baja_motivo'; motivo: string }
  | { tipo: 'baja_sin_motivo' }
  | { tipo: 'pendiente' }
  | { tipo: 'validar' }

/** (estado, fecha_baja, motivo_baja) → etiqueta legible. Ver decisiones de producto F-8. */
export function etiquetaEstadoTramo(
  tramo: Pick<HistoricoTramo, 'estado' | 'fecha_baja' | 'motivo_baja'>
): EtiquetaTramo {
  switch (tramo.estado) {
    case 'pendiente':
      return { tipo: 'pendiente' }
    case 'lista':
      return { tipo: 'validar' }
    case 'activa':
      // Una matrícula 'activa' sin fecha_baja está en curso; con fecha_baja (raro) ya cerrada.
      return tramo.fecha_baja === null ? { tipo: 'en_curso' } : { tipo: 'activa' }
    case 'baja': {
      const motivo = tramo.motivo_baja?.trim() ?? ''
      if (motivo === MOTIVO_PASA_CURSO) return { tipo: 'paso_curso' }
      if (motivo === MOTIVO_FIN_ETAPA) return { tipo: 'finalizo_etapa' }
      if (motivo.length > 0) return { tipo: 'baja_motivo', motivo }
      return { tipo: 'baja_sin_motivo' }
    }
  }
}

/**
 * Agrupa los tramos por curso académico. Cursos ordenados por `curso_fecha_inicio` DESC
 * (más reciente primero); dentro de cada curso, tramos por `fecha_alta` ASC (y `id` como
 * desempate estable). No muta la entrada.
 */
export function agruparHistoricoPorCurso(tramos: HistoricoTramo[]): CursoConTramos[] {
  const porCurso = new Map<string, CursoConTramos>()
  for (const t of tramos) {
    let grupo = porCurso.get(t.curso_id)
    if (!grupo) {
      grupo = {
        curso_id: t.curso_id,
        curso_nombre: t.curso_nombre,
        curso_fecha_inicio: t.curso_fecha_inicio,
        tramos: [],
      }
      porCurso.set(t.curso_id, grupo)
    }
    grupo.tramos.push(t)
  }

  const grupos = [...porCurso.values()]
  grupos.sort((a, b) => {
    const porFecha = b.curso_fecha_inicio.localeCompare(a.curso_fecha_inicio)
    return porFecha !== 0 ? porFecha : b.curso_nombre.localeCompare(a.curso_nombre)
  })
  for (const g of grupos) {
    g.tramos.sort((a, b) => {
      const porAlta = a.fecha_alta.localeCompare(b.fecha_alta)
      return porAlta !== 0 ? porAlta : a.id.localeCompare(b.id)
    })
  }
  return grupos
}
