import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { logger } from '@/shared/lib/logger'

import { RETENCION_FIRMAS_ANIOS } from '../types'

export interface ResultadoFirmas {
  /** En simulación solo se cuentan: no se borra nada. */
  dryRun: boolean
  /** Niños purgados con las firmas vencidas y algo que destruir. NULL si no se pudieron listar. */
  vencidos: number | null
  /** Filas destruidas, sumadas por tabla (vacío en simulación). */
  destruidas: Record<string, number>
  /** Los que fallaron: se reintentan en la siguiente pasada. */
  fallidos: number
}

/**
 * Destruye lo que se conserva por obligación de los niños purgados al vencer su plazo provisional
 * (`RETENCION_FIRMAS_ANIOS`) desde la baja (20261207120000): firmas, acuses, consentimientos,
 * medicación administrada, autorizaciones y eventos de ámbito niño, sin copia en audit_log, y el
 * registro de accesos cuando ya no mira nada. La BD respeta la retención. Respeta la simulación del
 * cron (`RETENCION_DRY_RUN`). Un fallo no tumba el resto del cron: se registra y se cuenta.
 */
export async function destruirFirmas(opts: { dryRun: boolean }): Promise<ResultadoFirmas> {
  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('firmas_vencidas', { p_anios: RETENCION_FIRMAS_ANIOS })
  if (error || !Array.isArray(data)) {
    logger.error('retención: firmas', error?.message ?? 'respuesta sin la forma esperada')
    return { dryRun: opts.dryRun, vencidos: null, destruidas: {}, fallidos: 0 }
  }
  if (opts.dryRun) return { dryRun: true, vencidos: data.length, destruidas: {}, fallidos: 0 }

  const destruidas: Record<string, number> = {}
  let fallidos = 0
  for (const v of data) {
    const { data: r, error: e } = await service.rpc('destruir_firmas_nino', {
      p_nino_id: v.nino_id,
      p_anios: RETENCION_FIRMAS_ANIOS,
    })
    if (e) {
      fallidos++
      logger.error(
        'retención: las firmas de un niño fallaron (se reintentará)',
        v.nino_id,
        e.message
      )
      continue
    }
    // NULL: entre la lista y aquí lo retuvieron. No es un fallo.
    for (const [tabla, n] of Object.entries(leerRecuento(r))) {
      destruidas[tabla] = (destruidas[tabla] ?? 0) + n
    }
  }
  return { dryRun: false, vencidos: data.length, destruidas, fallidos }
}

/** El recuento por tabla de `destruir_firmas_nino`; vacío si es NULL o tiene otra forma. */
export function leerRecuento(r: unknown): Record<string, number> {
  if (r === null || typeof r !== 'object' || Array.isArray(r)) return {}
  return Object.fromEntries(
    Object.entries(r).filter((e): e is [string, number] => typeof e[1] === 'number')
  )
}
