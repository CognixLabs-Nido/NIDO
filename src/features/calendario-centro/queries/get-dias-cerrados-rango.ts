import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { DiaCerradoProximo } from '../types'

const TIPOS_CERRADOS = ['festivo', 'vacaciones', 'cerrado'] as const

/**
 * Días cerrados (override en `dias_centro`) del centro en el rango
 * `[desde, hasta]` (fechas 'YYYY-MM-DD'), ordenados por fecha. Como
 * `getProximosDiasCerrados` pero acotado a un rango exacto y sin LIMIT — para el
 * resumen de Inicio (AG-15). Solo overrides explícitos: los sábados/domingos
 * "cerrados por default" no tienen fila y no aparecen.
 */
export async function getDiasCerradosRango(
  centroId: string,
  desde: string,
  hasta: string
): Promise<DiaCerradoProximo[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('dias_centro')
    .select('fecha, tipo, observaciones')
    .eq('centro_id', centroId)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .in('tipo', [...TIPOS_CERRADOS])
    .order('fecha', { ascending: true })

  if (error) {
    logger.warn('getDiasCerradosRango failed', error.message)
    return []
  }

  return (data ?? []).map((d) => ({
    fecha: d.fecha,
    tipo: d.tipo,
    observaciones: d.observaciones,
  }))
}
