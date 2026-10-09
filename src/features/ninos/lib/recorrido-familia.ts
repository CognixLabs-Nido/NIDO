/**
 * F-8 (familia) — Recorrido REDUCIDO del niño para sus tutores legales. Lógica PURA.
 *
 * La familia ve solo por dónde pasó su hijo: cursos y aulas en los que estuvo, con dos
 * etiquetas, «En curso» y «Terminado». No ve el papeleo interno que sí ve Dirección
 * (`HistorialMatriculas`): ni altas a medias (`pendiente`/`lista`), ni `motivo_baja`, ni
 * las etiquetas internas («Pasó de curso», «Baja: …», «Por validar»).
 *
 * Los tramos llegan de la RPC `get_recorrido_nino_familia`, que ya NO devuelve
 * `motivo_baja` ni los tramos `pendiente`/`lista`. El filtro de estado se repite aquí a
 * propósito: si la RPC cambiase, la pantalla seguiría sin enseñar altas a medias.
 */

import { agruparHistoricoPorCurso, type CursoConTramos } from './historico-matriculas'

export interface RecorridoTramo {
  id: string
  aula_nombre: string
  curso_id: string
  curso_nombre: string
  /** Fecha de inicio del curso académico — clave de orden cronológico. */
  curso_fecha_inicio: string
  fecha_alta: string
  fecha_baja: string | null
  estado: 'activa' | 'baja'
}

export type EtiquetaRecorrido = 'en_curso' | 'terminado'

/** «En curso» solo si la matrícula está activa y abierta; cualquier otra cosa terminó. */
export function etiquetaRecorrido(
  tramo: Pick<RecorridoTramo, 'estado' | 'fecha_baja'>
): EtiquetaRecorrido {
  return tramo.estado === 'activa' && tramo.fecha_baja === null ? 'en_curso' : 'terminado'
}

/**
 * Tramos visibles para la familia (solo `activa`/`baja`), agrupados por curso: el más
 * reciente primero y, dentro de cada curso, por fecha de alta.
 */
export function agruparRecorridoFamilia(
  tramos: readonly RecorridoTramo[]
): CursoConTramos<RecorridoTramo>[] {
  return agruparHistoricoPorCurso(
    tramos.filter((t) => t.estado === 'activa' || t.estado === 'baja')
  )
}
