'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, PREF_NOTIF_VISTO, type ActionResult } from '../types'

/**
 * Marca todas las novedades como vistas: sella el marcador `notificaciones_visto_at`
 * del usuario a `now()` en `preferencias_usuario` (upsert por usuario+clave, RLS
 * estricta por auth.uid()). A partir de aquí, el badge solo cuenta lo creado después.
 * Lo invoca la pestaña /notifications al abrirse (MarcarVistasOnMount).
 */
export async function marcarNotificacionesVistas(): Promise<ActionResult<void>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('notificaciones.errors.no_autorizado')

  const nowIso = new Date().toISOString()
  const { error } = await supabase
    .from('preferencias_usuario')
    .upsert(
      { usuario_id: user.id, clave: PREF_NOTIF_VISTO, valor: nowIso },
      { onConflict: 'usuario_id,clave' }
    )

  if (error) {
    logger.warn('marcarNotificacionesVistas: upsert', error.message)
    return fail('notificaciones.errors.marcar_fallo')
  }
  return ok(undefined)
}
