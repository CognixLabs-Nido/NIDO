import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/types/database'

type Client = SupabaseClient<Database>

/** Las 6 columnas de una firma que la sesión ya no lee de la tabla (las de la migración). */
export const COLUMNAS_CONTENIDO_FIRMA = [
  'nombre_tecleado',
  'firma_imagen',
  'ip_address',
  'user_agent',
  'comentario',
  'datos',
] as const

/**
 * El contenido de las firmas de autorización (trazo, IP, navegador, nombre tecleado, comentario y
 * `datos`): desde `20270115120000` sale por `contenido_firmas`, de quien firmó, del tutor legal, de
 * la profe del niño y de la Dirección. Mismo contrato que `leerFichaGestion`.
 */
export type ContenidoFirma = Database['public']['Functions']['contenido_firmas']['Returns'][number]

export async function leerContenidoFirmas(
  supabase: Client,
  firmaIds: string[]
): Promise<Map<string, ContenidoFirma> | null> {
  const ids = [...new Set(firmaIds)]
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase.rpc('contenido_firmas', { p_firma_ids: ids })
  if (error || !data) return null
  return new Map(data.map((f) => [f.firma_id, f]))
}

/**
 * Las firmas leídas de la tabla (con su `id`), con su `datos` de `contenido_firmas`. La firma cuyo
 * contenido no le toca a quien lee se queda con `datos: null`, como una firma sin datos: no la usa
 * nadie que no pueda leerla. `null` si la función falla: quien llama no puede seguir como si no
 * hubiera datos.
 */
export async function conDatosDeFirmas<F extends { id: string }>(
  supabase: Client,
  firmas: F[]
): Promise<Array<F & { datos: Json | null }> | null> {
  const contenido = await leerContenidoFirmas(
    supabase,
    firmas.map((f) => f.id)
  )
  if (!contenido) return null
  return firmas.map((f) => ({ ...f, datos: contenido.get(f.id)?.datos ?? null }))
}
