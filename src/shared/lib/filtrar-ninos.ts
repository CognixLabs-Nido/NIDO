/**
 * Las listas de niños del centro (decenas), con filtro por clase y búsqueda por nombre: el
 * catálogo de conceptos, la beca de comedor, Asignación permanente y el cargo a varios niños.
 * El pase de servicios (PR-12) tiene el suyo, por id de clase.
 */
export interface NinoFiltrable {
  nombre: string
  /** La clase del niño; null si no tiene. */
  aula: string | null
}

/** Los de una clase (o todos, con null) cuyo nombre contiene el texto, sin distinguir acentos. */
export function filtrarNinos<T extends NinoFiltrable>(
  lista: readonly T[],
  aula: string | null,
  texto: string
): T[] {
  const buscado = normalizar(texto.trim())
  return lista.filter(
    (n) =>
      (aula == null || n.aula === aula) &&
      (buscado === '' || normalizar(n.nombre).includes(buscado))
  )
}

/** Las clases de la lista, sin repetir y en orden. */
export function clasesDe(lista: readonly NinoFiltrable[]): string[] {
  return [...new Set(lista.map((n) => n.aula).filter((a): a is string => a != null))].sort((a, b) =>
    a.localeCompare(b, 'es-ES')
  )
}

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es-ES')
}
