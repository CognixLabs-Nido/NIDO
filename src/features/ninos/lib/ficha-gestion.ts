import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

/**
 * Las 14 columnas de gestión de `ninos` (notas de Dirección, DNI, observaciones, dirección con la
 * provincia, estado civil, libro de familia, hermanos y «cómo nos conoció»). Desde
 * `20270115130000` la sesión no las lee de la tabla: salen por `ficha_gestion_ninos`, que solo
 * contesta a la Dirección del centro y al tutor legal. Ni la profe ni el autorizado.
 *
 * Las filas que quien llama no puede leer no vienen (ni error). Por eso esto devuelve:
 * - `null` si la lectura falla (no se sabe);
 * - un mapa sin la clave del niño si no le toca (ausencia legítima);
 * - el mapa con sus columnas si le toca.
 */
export type FichaGestion = Database['public']['Functions']['ficha_gestion_ninos']['Returns'][number]

type Client = SupabaseClient<Database>

/** Las 14 columnas que la sesión ya no lee de `ninos` (las mismas que la migración deja fuera). */
export const COLUMNAS_GESTION_NINO = [
  'notas_admin',
  'dni',
  'observaciones_familia',
  'direccion_calle',
  'direccion_numero',
  'direccion_cp',
  'direccion_ciudad',
  'direccion_provincia',
  'estado_civil_familia',
  'libro_familia_path',
  'hermanos_total',
  'hermanos_lugar',
  'como_nos_conocio',
  'como_nos_conocio_otro',
] as const

export async function leerFichaGestion(
  supabase: Client,
  ninoIds: string[]
): Promise<Map<string, FichaGestion> | null> {
  const ids = [...new Set(ninoIds)]
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase.rpc('ficha_gestion_ninos', { p_nino_ids: ids })
  if (error || !data) return null
  return new Map(data.map((f) => [f.nino_id, f]))
}

/** Atajo para un niño: `undefined` = no le toca; `null` = la lectura falló. */
export async function leerFichaGestionDe(
  supabase: Client,
  ninoId: string
): Promise<FichaGestion | undefined | null> {
  const m = await leerFichaGestion(supabase, [ninoId])
  if (m === null) return null
  return m.get(ninoId)
}
