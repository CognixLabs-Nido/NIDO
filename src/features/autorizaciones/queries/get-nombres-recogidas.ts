import 'server-only'

import { createClient } from '@/lib/supabase/server'

/** El niño de una recogida, como lo da la base a quien consulta. */
export interface NinoDeRecogida {
  nombre: string
  apellidos: string | null
  /** ¿Es de un aula de quien consulta? Las suyas van primero en el listado. */
  deMiAula: boolean
}

/**
 * El nombre del niño de cada recogida (2026-11-21, decisión de Jose: cualquier profe del centro
 * consulta la recogida en la puerta, y sin el nombre la lista no dice de quién es). Lo da
 * `nombres_de_recogidas`, solo a través de su recogida y solo de niños con matrícula activa: no
 * abre la ficha ni sirve para listar niños por otro camino.
 *
 * Si la lectura falla, lanza: un listado sin nombres no es «no hay», es un listado que no sirve.
 */
export async function getNombresDeRecogidas(
  autorizacionIds: string[]
): Promise<Map<string, NinoDeRecogida>> {
  const out = new Map<string, NinoDeRecogida>()
  if (autorizacionIds.length === 0) return out
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('nombres_de_recogidas', {
    p_autorizacion_ids: autorizacionIds,
  })
  if (error) throw new Error(`getNombresDeRecogidas (${error.code ?? 'sin_codigo'})`)
  for (const r of data ?? []) {
    out.set(r.autorizacion_id, {
      nombre: r.nombre,
      apellidos: r.apellidos,
      deMiAula: r.de_mi_aula === true,
    })
  }
  return out
}

/** Su aula primero, después el centro; dentro de cada grupo, por apellidos y nombre. */
export function ordenarRecogidasParaLaPuerta<T extends { id: string }>(
  recogidas: T[],
  nombres: Map<string, NinoDeRecogida>
): { mias: T[]; centro: T[] } {
  const clave = (r: T) => {
    const n = nombres.get(r.id)
    return n ? `${n.apellidos ?? ''} ${n.nombre}`.trim().toLocaleLowerCase('es') : '￿'
  }
  const porNombre = (a: T, b: T) => clave(a).localeCompare(clave(b), 'es')
  return {
    mias: recogidas.filter((r) => nombres.get(r.id)?.deMiAula === true).sort(porNombre),
    centro: recogidas.filter((r) => nombres.get(r.id)?.deMiAula !== true).sort(porNombre),
  }
}
