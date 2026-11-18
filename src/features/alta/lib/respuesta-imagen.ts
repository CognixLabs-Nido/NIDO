import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/db'

/** La respuesta vigente de un tutor a la imagen de un niño: su «sí», su «no», o nada. */
export type RespuestaImagen = 'si' | 'no' | null

/**
 * La respuesta de un usuario a la imagen de un niño (fase 10, 10a-2). Decisión del responsable del
 * 2026-11-17: «CADA TUTOR RESPONDE POR SÍ», así que es la de esa persona, no la del niño. Se lee de
 * sus propias filas (`consentimientos_self_select`): el «sí» es `imagen` y el «no», `imagen_denegada`.
 * La base no deja los dos vigentes a la vez (cada uno retira el otro propio); si los hubiera, manda el
 * «no».
 *
 * `{ ok: false }` si la lectura falla: sin leerla no se sabe si contestó, y nunca se toma por «no ha
 * contestado».
 */
export async function leerRespuestaImagen(
  supabase: SupabaseClient<Database>,
  ninoId: string,
  usuarioId: string
): Promise<{ ok: true; respuesta: RespuestaImagen } | { ok: false }> {
  const { data, error } = await supabase
    .from('consentimientos')
    .select('tipo')
    .eq('usuario_id', usuarioId)
    .eq('nino_id', ninoId)
    .in('tipo', ['imagen', 'imagen_denegada'])
    .is('revocado_en', null)
  if (error || !data) return { ok: false }
  if (data.some((r) => r.tipo === 'imagen_denegada')) return { ok: true, respuesta: 'no' }
  if (data.some((r) => r.tipo === 'imagen')) return { ok: true, respuesta: 'si' }
  return { ok: true, respuesta: null }
}
