import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { DiaCerradoProximo } from '../types'

const TIPOS_CERRADOS = ['festivo', 'vacaciones', 'cerrado'] as const

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Devuelve los próximos días cerrados persistidos en `dias_centro` dentro
 * de los próximos `horizonteDias` días naturales (default 30) desde hoy
 * (incluye hoy si está cerrado), con LIMIT 5.
 *
 * Importante: este helper SOLO ve cierres marcados con override. Los
 * sábados/domingos que están "cerrados por default" NO aparecen — para
 * el widget no tiene utilidad informar de cada fin de semana. La
 * directora marca expresamente vacaciones y festivos, que es lo que
 * interesa anticipar.
 */
export async function getProximosDiasCerrados(
  centroId: string,
  horizonteDias = 30,
  limit = 5
): Promise<DiaCerradoProximo[]> {
  const supabase = await createClient()
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const hasta = new Date(hoy)
  hasta.setDate(hasta.getDate() + horizonteDias)

  const { data, error } = await supabase
    .from('dias_centro')
    .select('fecha, tipo, observaciones')
    .eq('centro_id', centroId)
    .gte('fecha', ymd(hoy))
    .lte('fecha', ymd(hasta))
    .in('tipo', [...TIPOS_CERRADOS])
    .order('fecha', { ascending: true })
    .limit(limit)

  if (error) {
    logger.warn('getProximosDiasCerrados failed', error.message)
    return []
  }

  return (data ?? []).map((d) => ({
    fecha: d.fecha,
    tipo: d.tipo,
    observaciones: d.observaciones,
  }))
}
