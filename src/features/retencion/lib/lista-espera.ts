import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { logger } from '@/shared/lib/logger'

import { RETENCION_LISTA_ESPERA_ANIOS } from '../types'

export interface ResultadoListaEspera {
  /** En simulación solo se cuentan: no se borra nada. */
  dryRun: boolean
  /** Los prospectos vencidos: borrados, o los que se borrarían en simulación. NULL si falló. */
  prospectos: number | null
}

/**
 * Borra los prospectos de la lista de espera que no llegaron a alta, al vencer su plazo provisional
 * (`RETENCION_LISTA_ESPERA_ANIOS`) desde que dejaron de estar vivos: el descarte o el final de su
 * curso (20261130120000). Respeta la simulación del cron (`RETENCION_DRY_RUN`). Un fallo no tumba
 * el resto del cron: se registra y se devuelve como NULL.
 */
export async function purgarListaEspera(opts: { dryRun: boolean }): Promise<ResultadoListaEspera> {
  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('purgar_lista_espera_vencida', {
    p_anios: RETENCION_LISTA_ESPERA_ANIOS + 1,
    p_simular: opts.dryRun,
  })
  if (error) {
    logger.error('retención: lista de espera', error.message)
    return { dryRun: opts.dryRun, prospectos: null }
  }
  return { dryRun: opts.dryRun, prospectos: data ?? 0 }
}
