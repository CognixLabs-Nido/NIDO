import type { ProfeAula } from '../types'

/**
 * Qué pinta la cabecera del hilo profe↔familia en la vista del TUTOR. Lo comparten
 * `ConversacionView` y `ConversacionesSplitView` para que ambas digan lo mismo.
 *
 *   - Hay persona principal (la profesora titular; si no hay, la coordinadora, ver
 *     `elegirPrincipal`) → su nombre + «Profe del aula X».
 *   - Sin principal y una sola persona → su nombre (como siempre).
 *   - Sin principal y varias personas (solo técnico/a y apoyo) → «Aula X · N profes».
 *   - Nadie asignado → «Aula X»; sin aula → el nombre del niño.
 * La cabecera nunca queda vacía.
 */
export type CabeceraTutor =
  | { tipo: 'profe'; nombre: string }
  | { tipo: 'aula_con_profes'; n: number }
  | { tipo: 'aula_sin_profe' }
  | { tipo: 'nino' }

export function resolverCabeceraTutor(
  profes: readonly ProfeAula[],
  aulaNombre: string | null
): CabeceraTutor {
  const principal = profes.find((p) => p.es_principal)
  if (principal) return { tipo: 'profe', nombre: principal.nombre_completo }
  if (profes.length === 1 && profes[0]) return { tipo: 'profe', nombre: profes[0].nombre_completo }
  if (profes.length > 1 && aulaNombre) return { tipo: 'aula_con_profes', n: profes.length }
  if (aulaNombre) return { tipo: 'aula_sin_profe' }
  return { tipo: 'nino' }
}
