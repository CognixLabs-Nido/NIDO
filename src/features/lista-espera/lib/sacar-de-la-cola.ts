import type { SupabaseClient } from '@supabase/supabase-js'

import { escrituraSecundariaFallida } from '@/shared/lib/tras-escritura'
import type { Database } from '@/types/db'

/**
 * Saca de la cola el prospecto cuya alta YA está creada (`estado = 'invitado'` y su `nino_id`).
 *
 * Censo C (2026-11-26): antes era «best-effort: si falla, log». Pero un prospecto que se queda «en espera»
 * con el alta hecha invita a darla otra vez, y un segundo «Invitar» o «Completar» crea OTRO niño (lo decía
 * ya el comentario de `invitarAlAlta`). No se para: el alta existe y deshacerla no es cosa de este paso. Va
 * a Sentry y devuelve `true`, para que la pantalla le diga a Dirección que no la vuelva a dar.
 *
 * @returns `true` si el prospecto SIGUE en la cola.
 */
export async function sacarDeLaCola(
  supabase: SupabaseClient<Database>,
  prospectoId: string,
  ninoId: string,
  donde: string
): Promise<boolean> {
  const { error } = await supabase
    .from('lista_espera')
    .update({ estado: 'invitado', nino_id: ninoId })
    .eq('id', prospectoId)
  if (error) {
    escrituraSecundariaFallida(`${donde}: sacar el prospecto de la cola`, error)
    return true
  }
  return false
}

/** Lo que se añade al resultado cuando el prospecto se ha quedado en la cola. */
export const siSigueEnCola = (sigue: boolean): { sigueEnCola?: true } =>
  sigue ? { sigueEnCola: true } : {}
