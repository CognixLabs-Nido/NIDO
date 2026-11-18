import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/db'

type Client = SupabaseClient<Database>

/**
 * Fase 10b: las 4 columnas de una firma de la ficha que la sesión no lee de la tabla (`20270128120000`
 * no se las da en el GRANT). La quinta cerrada, `contenido_cifrado` (la foto de lo firmado), no sale
 * por ninguna función a la app: la lee la 10c. `columnas-cerradas-migracion.test.ts` afirma que estas
 * cuatro, el GRANT y la foto suman la tabla de la migración.
 */
export const COLUMNAS_CONTENIDO_FIRMA_FICHA = [
  'nombre_tecleado',
  'firma_imagen',
  'ip_address',
  'user_agent',
] as const

/**
 * El contenido de las firmas de la ficha (trazo, IP, navegador y nombre tecleado), por
 * `contenido_firmas_ficha`: de quien firmó, del tutor legal y de la Dirección del niño. Mismo
 * contrato que `leerContenidoFirmasDocumentos`: `null` si la función falla, y la firma que no le toca
 * a quien lee no viene.
 */
export type ContenidoFirmaFicha =
  Database['public']['Functions']['contenido_firmas_ficha']['Returns'][number]

export async function leerContenidoFirmasFicha(
  supabase: Client,
  firmaIds: string[]
): Promise<Map<string, ContenidoFirmaFicha> | null> {
  const ids = [...new Set(firmaIds)]
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase.rpc('contenido_firmas_ficha', { p_firma_ids: ids })
  if (error || !data) return null
  return new Map(data.map((f) => [f.firma_id, f]))
}
