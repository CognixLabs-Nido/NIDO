'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, PREF_FOTOS_VISTAS, type ActionResult } from '../types'

/**
 * Marca como VISTAS por la familia actual las publicaciones indicadas (F10-2): sella
 * cada `id` con `now()` en el mapa `fotos_vistas` de `preferencias_usuario`. Lo invoca
 * la vista del blog al montarse (`MarcarFotosVistasOnMount`) con los ids visibles, de
 * modo que "al verlas, el contador baja" (P8). Read-modify-write del JSON (la carrera
 * entre pestañas es benigna: a lo sumo re-cuenta). Editar una publicación no re-avisa
 * (solo importa la presencia de la clave).
 */
export async function marcarFotosVistas(ids: string[]): Promise<ActionResult<void>> {
  if (ids.length === 0) return ok(undefined)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('notificaciones.errors.no_autorizado')

  const { data: pref } = await supabase
    .from('preferencias_usuario')
    .select('valor')
    .eq('clave', PREF_FOTOS_VISTAS)
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
  for (const id of ids) {
    if (!mapa[id]) mapa[id] = ahora
  }

  const { error } = await supabase
    .from('preferencias_usuario')
    .upsert(
      { usuario_id: user.id, clave: PREF_FOTOS_VISTAS, valor: JSON.stringify(mapa) },
      { onConflict: 'usuario_id,clave' }
    )

  if (error) {
    logger.warn('marcarFotosVistas: upsert', error.message)
    return fail('notificaciones.errors.marcar_fallo')
  }
  return ok(undefined)
}
