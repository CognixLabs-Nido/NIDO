import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { logger } from '@/shared/lib/logger'

import { RETENCION_REGISTROS_DERECHOS_ANIOS } from '../types'

export interface ResultadoExportLog {
  /** En simulación solo se cuentan: no se borra nada. */
  dryRun: boolean
  /** Las filas de export_log vencidas: borradas, o las que se borrarían en simulación. NULL si falló. */
  filas: number | null
}

/**
 * Borra las filas de export_log más antiguas que el plazo provisional
 * (`RETENCION_REGISTROS_DERECHOS_ANIOS`, 20261210120000). Las peticiones de olvido no tienen plazo:
 * no se borran por tiempo. Respeta la simulación del cron (`RETENCION_DRY_RUN`). Un fallo no tumba
 * el resto del cron: se registra y se devuelve como NULL.
 */
export async function purgarExportLog(opts: { dryRun: boolean }): Promise<ResultadoExportLog> {
  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('purgar_export_log', {
    p_anios: RETENCION_REGISTROS_DERECHOS_ANIOS,
    p_simular: opts.dryRun,
  })
  if (error) {
    logger.error('retención: export_log', error.message)
    return { dryRun: opts.dryRun, filas: null }
  }
  return { dryRun: opts.dryRun, filas: data ?? 0 }
}
