import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { AutorizacionItem, EstadoFirmaNino, FirmaDecision } from '../types'

/**
 * Lista de autorizaciones **publicadas** (todos los tipos) que el tutor puede ver (RLS),
 * con su `estado_firma` = última decisión propia (firmado/rechazado/revocado) o
 * `pendiente` si aún no ha actuado. El detalle por niño es la fuente autoritativa
 * (un tutor con varios niños lo ve desglosado allí); aquí mostramos su acción.
 */
export async function getAutorizacionesFamilia(): Promise<AutorizacionItem[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('autorizaciones')
    .select(
      'id, tipo, titulo, estado, texto_definitivo, evento_id, nino_id, es_plantilla, ambito, vigencia_desde, vigencia_hasta, created_at'
    )
    .eq('estado', 'publicada')
    // Las plantillas del catálogo NO son firmables (visibles a miembros del centro
    // por RLS); la familia solo ve INSTANCIAS firmables.
    .eq('es_plantilla', false)
    .order('created_at', { ascending: false })

  if (error) {
    logger.warn('getAutorizacionesFamilia', error.message)
    return []
  }
  const autorizaciones = data ?? []
  if (autorizaciones.length === 0) return []

  // Última decisión propia por autorización (append-only → la más reciente gana).
  const ids = autorizaciones.map((a) => a.id)
  const { data: firmas } = await supabase
    .from('firmas_autorizacion')
    .select('autorizacion_id, decision, firmado_at')
    .eq('firmante_id', user.id)
    .in('autorizacion_id', ids)
    .order('firmado_at', { ascending: true })

  const ultimaPorAut = new Map<string, FirmaDecision>()
  for (const f of firmas ?? []) ultimaPorAut.set(f.autorizacion_id, f.decision)

  return autorizaciones.map((a) => ({
    ...a,
    estado_firma: (ultimaPorAut.get(a.id) ?? 'pendiente') as EstadoFirmaNino,
  })) as AutorizacionItem[]
}
