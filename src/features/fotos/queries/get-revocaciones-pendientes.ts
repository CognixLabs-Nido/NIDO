import 'server-only'

import { createClient } from '@/lib/supabase/server'

export interface RevocacionPendiente {
  ninoId: string
  nombre: string
  apellidos: string | null
  pendientes: number
}

/**
 * IU-5 — listado general de revocaciones con fotos pendientes de resolver (Dirección).
 * Niños con imagen NO vigente (`puede_aparecer_en_fotos = false`, el flag derivado) que
 * aún tienen etiquetas sin resolver (`resuelta_en IS NULL`). Cuenta las etiquetas
 * pendientes por niño. RLS: admin ve las etiquetas de su centro (rama `es_admin` de
 * `usuario_ve_publicacion_row`); un no-admin no ve nada aquí. Cuando un niño llega a 0
 * pendientes, desaparece del listado.
 */
export async function getRevocacionesPendientes(centroId: string): Promise<RevocacionPendiente[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('media_etiquetas')
    .select('nino_id, ninos!inner(id, nombre, apellidos, puede_aparecer_en_fotos)')
    .eq('centro_id', centroId)
    .is('resuelta_en', null)
    .eq('ninos.puede_aparecer_en_fotos', false)

  if (!data) return []

  const porNino = new Map<string, RevocacionPendiente>()
  for (const row of data) {
    const nino = row.ninos as unknown as { nombre: string; apellidos: string | null }
    const actual = porNino.get(row.nino_id)
    if (actual) {
      actual.pendientes += 1
    } else {
      porNino.set(row.nino_id, {
        ninoId: row.nino_id,
        nombre: nino.nombre,
        apellidos: nino.apellidos,
        pendientes: 1,
      })
    }
  }

  return [...porNino.values()].sort(
    (a, b) =>
      b.pendientes - a.pendientes ||
      `${a.nombre} ${a.apellidos ?? ''}`.localeCompare(`${b.nombre} ${b.apellidos ?? ''}`)
  )
}
