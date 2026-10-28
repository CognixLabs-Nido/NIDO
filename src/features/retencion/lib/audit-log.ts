import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { logger } from '@/shared/lib/logger'

import { RETENCION_AUDIT_LOG_ANIOS } from '../types'

export interface ResultadoAuditLog {
  /** En simulación solo se cuentan: no se borra nada. */
  dryRun: boolean
  /** Las filas de audit_log vencidas: borradas, o las que se borrarían en simulación. NULL si falló. */
  filas: number | null
}

/**
 * Borra las filas de audit_log más antiguas que el plazo provisional (`RETENCION_AUDIT_LOG_ANIOS`).
 * Respeta la simulación del cron (`RETENCION_DRY_RUN`). Un fallo no tumba el resto del cron: se
 * registra y se devuelve como NULL.
 */
export async function purgarAuditLog(opts: { dryRun: boolean }): Promise<ResultadoAuditLog> {
  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('purgar_audit_log', {
    p_anios: RETENCION_AUDIT_LOG_ANIOS,
    p_simular: opts.dryRun,
  })
  if (error) {
    logger.error('retención: audit_log', error.message)
    return { dryRun: opts.dryRun, filas: null }
  }
  return { dryRun: opts.dryRun, filas: data ?? 0 }
}
