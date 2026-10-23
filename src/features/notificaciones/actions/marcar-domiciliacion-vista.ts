'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, PREF_DOMICILIACIONES_VISTAS, type ActionResult } from '../types'

/**
 * Marca la domiciliación de una familia como VISTA por Dirección: sella su `familia_id` con
 * `now()` en el mapa `domiciliaciones_vistas` de `preferencias_usuario`. A partir de aquí, el
 * aviso de "domiciliación nueva" del inicio deja de contar los mandatos de esa familia
 * firmados antes de este instante → el aviso desaparece. Lo invoca la ficha de la familia al
 * abrirse (MarcarDomiciliacionVistaOnMount). Read-modify-write del JSON (la carrera entre
 * tabs es benigna: a lo sumo re-cuenta).
 */
export async function marcarDomiciliacionVista(familiaId: string): Promise<ActionResult<void>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('notificaciones.errors.no_autorizado')

  const { data: pref } = await supabase
    .from('preferencias_usuario')
    .select('valor')
    .eq('clave', PREF_DOMICILIACIONES_VISTAS)
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
  mapa[familiaId] = new Date().toISOString()

  const { error } = await supabase
    .from('preferencias_usuario')
    .upsert(
      { usuario_id: user.id, clave: PREF_DOMICILIACIONES_VISTAS, valor: JSON.stringify(mapa) },
      { onConflict: 'usuario_id,clave' }
    )

  if (error) {
    logger.warn('marcarDomiciliacionVista: upsert', error.message)
    return fail('notificaciones.errors.marcar_fallo')
  }
  return ok(undefined)
}
