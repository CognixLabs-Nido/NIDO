'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, PREF_INFORMES_VISTOS, type ActionResult } from '../types'

/**
 * Marca un informe de evolución como VISTO por la familia actual (F9-3): sella su
 * `id` con `now()` en el mapa `informes_vistos` de `preferencias_usuario`. A partir
 * de aquí, el aviso de "informes nuevos" del panel de inicio deja de contarlo (el
 * aviso desaparece y baja el contador). Lo invoca el detalle del informe al abrirse
 * (MarcarInformeVistoOnMount). Read-modify-write del JSON (la carrera entre tabs es
 * benigna: a lo sumo re-cuenta). No re-avisa al republicar — solo importa la presencia.
 */
export async function marcarInformeVisto(informeId: string): Promise<ActionResult<void>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('notificaciones.errors.no_autorizado')

  const { data: pref } = await supabase
    .from('preferencias_usuario')
    .select('valor')
    .eq('clave', PREF_INFORMES_VISTOS)
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
  mapa[informeId] = new Date().toISOString()

  const { error } = await supabase
    .from('preferencias_usuario')
    .upsert(
      { usuario_id: user.id, clave: PREF_INFORMES_VISTOS, valor: JSON.stringify(mapa) },
      { onConflict: 'usuario_id,clave' }
    )

  if (error) {
    logger.warn('marcarInformeVisto: upsert', error.message)
    return fail('notificaciones.errors.marcar_fallo')
  }
  return ok(undefined)
}
