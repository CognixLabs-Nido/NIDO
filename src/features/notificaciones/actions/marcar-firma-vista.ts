'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, PREF_FIRMAS_VISTAS, type ActionResult } from '../types'

/**
 * Marca una autorización como VISTA por el usuario actual: sella su `id` con `now()`
 * en el mapa `autorizaciones_firmas_vistas` de `preferencias_usuario`. A partir de
 * aquí, el aviso de "nueva firma" del panel deja de contar las firmas de esa
 * autorización (anteriores a este instante) → el aviso desaparece y baja el contador.
 * Lo invoca el detalle de la autorización al abrirse (MarcarFirmaVistaOnMount).
 * Read-modify-write del JSON (la carrera entre tabs es benigna: a lo sumo re-cuenta).
 */
export async function marcarFirmaVista(autorizacionId: string): Promise<ActionResult<void>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('notificaciones.errors.no_autorizado')

  const { data: pref } = await supabase
    .from('preferencias_usuario')
    .select('valor')
    .eq('clave', PREF_FIRMAS_VISTAS)
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
  mapa[autorizacionId] = new Date().toISOString()

  const { error } = await supabase
    .from('preferencias_usuario')
    .upsert(
      { usuario_id: user.id, clave: PREF_FIRMAS_VISTAS, valor: JSON.stringify(mapa) },
      { onConflict: 'usuario_id,clave' }
    )

  if (error) {
    logger.warn('marcarFirmaVista: upsert', error.message)
    return fail('notificaciones.errors.marcar_fallo')
  }
  return ok(undefined)
}
