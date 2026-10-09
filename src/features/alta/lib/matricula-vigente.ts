/**
 * Estado de la matrícula que gobierna la entrada al asistente de alta (`/alta/[ninoId]`).
 *
 * Un niño puede tener VARIAS matrículas vigentes (`fecha_baja` y `deleted_at` nulos): una
 * por curso (multicurso F11-H), p. ej. la `activa` de este curso + la `pendiente` del
 * siguiente que crea el pase de curso. Antes la página leía con `maybeSingle()`, que con dos
 * filas da error y dejaba el estado en `null`: al tutor de un alumno activo se le reabría el
 * asistente. Mismo arreglo que `altaValidada` (gate.ts) y `clasificarAltaPorHijo`: si
 * ALGUNA es `activa`, el alta está validada.
 *
 * Prioridad: `activa` > `lista` > `pendiente` > `baja`. Sin matrículas vigentes → `null`.
 */
export type EstadoMatricula = 'pendiente' | 'lista' | 'activa' | 'baja'

const PRIORIDAD: readonly EstadoMatricula[] = ['activa', 'lista', 'pendiente', 'baja']

export function estadoMatriculaVigente(
  matriculas: ReadonlyArray<{ estado: EstadoMatricula }>
): EstadoMatricula | null {
  return PRIORIDAD.find((e) => matriculas.some((m) => m.estado === e)) ?? null
}
