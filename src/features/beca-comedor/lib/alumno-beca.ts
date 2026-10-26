import type { AlumnoElegibilidad } from '../queries/get-elegibilidad-becados'

/**
 * Un alumno de la pestaña de beca comedor, con lo que necesitan sus listas para filtrar: la clase
 * (filtro por aula) y el año de nacimiento (seleccionar por edad en la carga). Lo añade la página
 * desde la lista del centro.
 */
export interface AlumnoBeca extends AlumnoElegibilidad {
  aula: string | null
  anioNacimiento: number | null
}

/** Los años de nacimiento de la lista, sin repetir, del más reciente al más antiguo. */
export function aniosDe(lista: ReadonlyArray<{ anioNacimiento: number | null }>): number[] {
  return [
    ...new Set(lista.map((a) => a.anioNacimiento).filter((a): a is number => a != null)),
  ].sort((a, b) => b - a)
}

/**
 * Seleccionar por edad: si todos los de ese año ya están elegidos, se quitan; si no, se añaden.
 * Solo los `elegibles` (los que se pueden tocar).
 */
export function alternarAnio(
  seleccion: ReadonlySet<string>,
  elegibles: ReadonlyArray<{ id: string; anioNacimiento: number | null }>,
  anio: number
): Set<string> {
  const delAnio = elegibles.filter((a) => a.anioNacimiento === anio).map((a) => a.id)
  const next = new Set(seleccion)
  const todos = delAnio.length > 0 && delAnio.every((id) => next.has(id))
  for (const id of delAnio) {
    if (todos) next.delete(id)
    else next.add(id)
  }
  return next
}
