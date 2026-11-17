import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/db'

type Client = SupabaseClient<Database>

/**
 * Las 4 columnas de una firma de un documento del centro que la sesión ya no lee de la tabla (las de
 * `20270125130000`, que se COPIAN de su guarda: `columnas-cerradas-migracion.test.ts`).
 */
export const COLUMNAS_CONTENIDO_FIRMA_DOCUMENTO = [
  'nombre_tecleado',
  'firma_imagen',
  'ip_address',
  'user_agent',
] as const

/**
 * El contenido de las firmas de los documentos del centro (trazo, IP, navegador y nombre tecleado):
 * desde `20270125130000` sale por `contenido_firmas_documentos`, de quien firmó, del tutor legal y
 * de la Dirección. Mismo contrato que `leerContenidoFirmas`: `null` si la función falla, y la firma
 * que no le toca a quien lee no viene.
 */
export type ContenidoFirmaDocumento =
  Database['public']['Functions']['contenido_firmas_documentos']['Returns'][number]

export async function leerContenidoFirmasDocumentos(
  supabase: Client,
  firmaIds: string[]
): Promise<Map<string, ContenidoFirmaDocumento> | null> {
  const ids = [...new Set(firmaIds)]
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase.rpc('contenido_firmas_documentos', { p_firma_ids: ids })
  if (error || !data) return null
  return new Map(data.map((f) => [f.firma_id, f]))
}
