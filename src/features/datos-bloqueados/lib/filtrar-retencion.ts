import { clasesDe, filtrarNinos } from '@/shared/lib/filtrar-ninos'

/** Lo que el listado de la retención necesita de cada fila de `sujetos_retencion`. */
export interface SujetoListado {
  sujeto_tipo: string
  sujeto_id: string
  nombre: string | null
  familia: string | null
  aula: string | null
  estado: string
  retenido_desde: string | null
}

export type TipoFiltro = 'todos' | 'nino' | 'usuario'
export type EstadoFiltro = 'todos' | 'activo' | 'baja' | 'purgado'

export interface FiltroRetencion {
  aula: string | null
  texto: string
  tipo: TipoFiltro
  estado: EstadoFiltro
  soloRetenidos: boolean
}

/** La clave de un sujeto en la selección: un niño y un adulto pueden compartir id. */
export function claveSujeto(s: Pick<SujetoListado, 'sujeto_tipo' | 'sujeto_id'>): string {
  return `${s.sujeto_tipo}:${s.sujeto_id}`
}

/**
 * Los sujetos que pasan el filtro. La búsqueda mira el nombre y la familia: el nombre de un niño
 * purgado es «[borrado]», y a él se le encuentra por su familia.
 */
export function filtrarSujetos<T extends SujetoListado>(
  lista: readonly T[],
  f: FiltroRetencion
): T[] {
  const previos = lista.filter(
    (s) =>
      (f.tipo === 'todos' || s.sujeto_tipo === f.tipo) &&
      (f.estado === 'todos' || s.estado === f.estado) &&
      (!f.soloRetenidos || s.retenido_desde != null)
  )
  const buscables = previos.map((s) => ({
    s,
    nombre: [s.nombre, s.familia].filter(Boolean).join(' '),
    aula: s.aula,
  }))
  return filtrarNinos(buscables, f.aula, f.texto).map((b) => b.s)
}

/** Las clases de la lista, para el filtro. */
export function clasesDeSujetos(lista: readonly SujetoListado[]): string[] {
  return clasesDe(lista.map((s) => ({ nombre: s.nombre ?? '', aula: s.aula })))
}
