import type { ContenidoBloqueado, Fila } from '../types'

/**
 * La respuesta de `ver_datos_bloqueados` con su forma, o NULL si no la tiene. Un apartado que no
 * es una lista se queda fuera; uno que falta no se inventa.
 */
export function leerContenido(data: unknown): ContenidoBloqueado | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  const apartados = d.apartados
  if (!apartados || typeof apartados !== 'object') return null
  const out: Record<string, Fila[]> = {}
  for (const [k, v] of Object.entries(apartados as Record<string, unknown>)) {
    if (Array.isArray(v)) out[k] = v.filter((x): x is Fila => !!x && typeof x === 'object')
  }
  return {
    bloqueadoDesde: typeof d.bloqueado_desde === 'string' ? d.bloqueado_desde : null,
    apartados: out,
  }
}
