import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/db'

/**
 * Fase 7 (2026-11-13): la tarjeta sanitaria del niño. El número y la ruta de la imagen viven en
 * `ninos` (D7: en claro, con los datos del niño, no en la ficha médica cifrada), cerrados para la
 * sesión. Se leen por `sip_de_ninos`:
 * - el número, la Dirección del centro, el tutor legal y la profe del niño;
 * - la ruta de la imagen, solo la Dirección y el tutor legal (`ve_documento`). A la profe le llega
 *   NULL con `ve_documento` false: «no la ves» no es «no hay imagen»;
 * - el autorizado no recibe filas.
 *
 * Como `leerFichaGestion`: `null` si la lectura falla (no se sabe), un mapa sin la clave del niño si
 * no le toca, y el mapa con su fila si le toca.
 */
export type TarjetaSanitaria = Database['public']['Functions']['sip_de_ninos']['Returns'][number]

type Client = SupabaseClient<Database>

/** Las dos columnas de `ninos` que la sesión no lee de la tabla y salen por `sip_de_ninos`. */
export const COLUMNAS_TARJETA_NINO = ['sip', 'sip_documento_path'] as const

export async function leerTarjetasSanitarias(
  supabase: Client,
  ninoIds: string[]
): Promise<Map<string, TarjetaSanitaria> | null> {
  const ids = [...new Set(ninoIds)]
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase.rpc('sip_de_ninos', { p_nino_ids: ids })
  if (error || !data) return null
  return new Map(data.map((f) => [f.nino_id, f]))
}

/** Atajo para un niño: `undefined` = no le toca; `null` = la lectura falló. */
export async function leerTarjetaSanitariaDe(
  supabase: Client,
  ninoId: string
): Promise<TarjetaSanitaria | undefined | null> {
  const m = await leerTarjetasSanitarias(supabase, [ninoId])
  if (m === null) return null
  return m.get(ninoId)
}
