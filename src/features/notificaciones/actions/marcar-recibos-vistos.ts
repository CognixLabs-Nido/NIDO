'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, PREF_RECIBOS_VISTOS, type ActionResult } from '../types'

/**
 * Marca una tanda de recibos como VISTOS por la familia actual (F12-B-7): sella cada
 * `id` con `now()` en el mapa `recibos_vistos` de `preferencias_usuario`. A partir de
 * aquí, el aviso de "recibos nuevos" del panel de inicio deja de contarlos. Lo invoca
 * la lista de recibos de la familia al abrirse (MarcarRecibosVistosOnMount) con todos
 * los recibos visibles. Read-modify-write del JSON (la carrera entre tabs es benigna:
 * a lo sumo re-cuenta). Solo importa la presencia de la clave.
 */
export async function marcarRecibosVistos(reciboIds: string[]): Promise<ActionResult<void>> {
  if (reciboIds.length === 0) return ok(undefined)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('notificaciones.errors.no_autorizado')

  const { data: pref } = await supabase
    .from('preferencias_usuario')
    .select('valor')
    .eq('clave', PREF_RECIBOS_VISTOS)
    .maybeSingle()

  let mapa: Record<string, string> = {}
  if (pref?.valor) {
    try {
      const parsed = JSON.parse(pref.valor)
      if (parsed && typeof parsed === 'object') mapa = parsed as Record<string, string>
    } catch {
      mapa = {}
    }
  }
  const ahora = new Date().toISOString()
  for (const id of reciboIds) mapa[id] = ahora

  const { error } = await supabase
    .from('preferencias_usuario')
    .upsert(
      { usuario_id: user.id, clave: PREF_RECIBOS_VISTOS, valor: JSON.stringify(mapa) },
      { onConflict: 'usuario_id,clave' }
    )

  if (error) {
    logger.warn('marcarRecibosVistos: upsert', error.message)
    return fail('notificaciones.errors.marcar_fallo')
  }
  return ok(undefined)
}
