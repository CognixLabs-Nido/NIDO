import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { logger } from '@/shared/lib/logger'

import { RETENCION_OPERATIVA_ANIOS, TABLAS_OPERATIVA, type TablaOperativa } from '../types'

export interface ResultadoOperativa {
  /** En simulación solo se cuentan: no se borra nada. */
  dryRun: boolean
  /**
   * Por tabla, las filas vencidas (borradas, o las que se borrarían en simulación), y las copias
   * huérfanas de audit_log. NULL si falló o si la respuesta no tiene la forma esperada.
   */
  filas: (Record<TablaOperativa, number> & { copias_huerfanas: number }) | null
}

function leerFilas(data: unknown): ResultadoOperativa['filas'] {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const r = data as Record<string, unknown>
  const claves = [...TABLAS_OPERATIVA, 'copias_huerfanas'] as const
  if (!claves.every((k) => typeof r[k] === 'number')) return null
  return Object.fromEntries(claves.map((k) => [k, r[k] as number])) as NonNullable<
    ResultadoOperativa['filas']
  >
}

/**
 * Borra la operativa del día a día al vencer su plazo provisional (`RETENCION_OPERATIVA_ANIOS`)
 * desde el final del curso en que se escribió, con sus copias en audit_log (20261203120000).
 * Respeta la simulación del cron (`RETENCION_DRY_RUN`). Un fallo no tumba el resto del cron: se
 * registra y se devuelve como NULL.
 */
export async function purgarOperativa(opts: { dryRun: boolean }): Promise<ResultadoOperativa> {
  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('purgar_operativa_vencida', {
    p_anios: RETENCION_OPERATIVA_ANIOS,
    p_simular: opts.dryRun,
  })
  if (error) {
    logger.error('retención: operativa', error.message)
    return { dryRun: opts.dryRun, filas: null }
  }
  const filas = leerFilas(data)
  if (!filas) logger.error('retención: operativa', 'respuesta sin la forma esperada')
  return { dryRun: opts.dryRun, filas }
}
