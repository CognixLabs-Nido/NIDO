import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Devuelve el id de la conversación existente para un niño, o null si
 * todavía no existe. Útil para el botón "Escribir a la familia/profe"
 * desde la ficha del niño: si existe, navega directo al hilo; si no,
 * navega a la vista de composer que la creará al enviar el primer mensaje.
 *
 * RLS filtra: solo devuelve la conversación si el usuario participa
 * (profe/admin del centro o tutor con permiso).
 */
export async function getConversacionByNino(ninoId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('conversaciones')
    .select('id')
    .eq('nino_id', ninoId)
    .maybeSingle()
  return data?.id ?? null
}
