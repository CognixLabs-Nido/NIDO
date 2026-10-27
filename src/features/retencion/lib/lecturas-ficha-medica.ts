import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { logger } from '@/shared/lib/logger'

import { RETENCION_LECTURAS_FICHA_MEDICA_MESES } from '../types'

export interface ResultadoLecturas {
  /** En simulación solo se cuentan: no se borra nada. */
  dryRun: boolean
  /** Las lecturas vencidas: borradas, o las que se borrarían en simulación. NULL si falló. */
  lecturas: number | null
}

/**
 * Borra las lecturas de la ficha médica más antiguas que el plazo provisional
 * (`RETENCION_LECTURAS_FICHA_MEDICA_MESES`). Respeta la simulación del cron (`RETENCION_DRY_RUN`).
 * Un fallo no tumba el resto del cron: se registra y se devuelve como NULL.
 */
export async function purgarLecturasFichaMedica(opts: {
  dryRun: boolean
}): Promise<ResultadoLecturas> {
  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('purgar_lecturas_ficha_medica', {
    p_meses: RETENCION_LECTURAS_FICHA_MEDICA_MESES,
    p_simular: opts.dryRun,
  })
  if (error) {
    logger.error('retención: lecturas de la ficha médica', error.message)
    return { dryRun: opts.dryRun, lecturas: null }
  }
  return { dryRun: opts.dryRun, lecturas: data ?? 0 }
}
