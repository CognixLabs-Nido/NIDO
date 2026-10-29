import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { BUCKET_DNI_TUTORES, BUCKET_MANDATO_SEPA } from '@/shared/lib/adjuntos/storage'
import { logger } from '@/shared/lib/logger'

import type { Database } from '@/types/database'

import { RETENCION_FISCAL_ANIOS, RETENCION_MANDATOS_SEPA_ANIOS } from '../types'

type Service = SupabaseClient<Database>
type Vencida = Database['public']['Functions']['familias_fiscal_vencidas']['Returns'][number]

/**
 * Los mandatos se van con lo fiscal de su familia: el plazo es el más largo de los dos, para que
 * ninguno se destruya antes de su tiempo.
 */
export const ANIOS_FISCAL = Math.max(RETENCION_FISCAL_ANIOS, RETENCION_MANDATOS_SEPA_ANIOS)

export interface ResultadoFiscal {
  /** En simulación solo se cuentan: no se borra nada. */
  dryRun: boolean
  /** Familias con lo fiscal vencido. NULL si no se pudieron listar. */
  vencidas: number | null
  /** Destruidas (0 en simulación). */
  destruidas: number
  /** Las que fallaron: siguen enteras y se reintentan en la siguiente pasada. */
  fallidas: number
}

/**
 * Destruye lo fiscal de las familias a los N años (`ANIOS_FISCAL`) de su último recibo pagado o,
 * sin ninguno, del final del curso de la baja de su último hijo (20261208120000): los recibos con
 * sus líneas y su parte de las remesas, los mandatos y su documento, el método de pago, las
 * asignaciones, el parte de servicio, las becas, los tutores, la familia y las fichas ya anónimas de
 * los niños. La BD espera al dinero vivo, a la retención y a que todo lo anterior esté purgado.
 * Respeta la simulación del cron. Un fallo no tumba el resto: se registra y se cuenta.
 */
export async function destruirFiscal(opts: { dryRun: boolean }): Promise<ResultadoFiscal> {
  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('familias_fiscal_vencidas', { p_anios: ANIOS_FISCAL })
  if (error || !Array.isArray(data)) {
    logger.error('retención: fiscal', error?.message ?? 'respuesta sin la forma esperada')
    return { dryRun: opts.dryRun, vencidas: null, destruidas: 0, fallidas: 0 }
  }
  if (opts.dryRun) return { dryRun: true, vencidas: data.length, destruidas: 0, fallidas: 0 }

  let destruidas = 0
  let fallidas = 0
  for (const v of data) {
    try {
      if (await destruirUna(service, v)) destruidas++
    } catch (e) {
      fallidas++
      logger.error(
        'retención: lo fiscal de una familia falló (se reintentará)',
        v.familia_id,
        e instanceof Error ? e.message : String(e)
      )
    }
  }
  return { dryRun: false, vencidas: data.length, destruidas, fallidas }
}

/**
 * Una familia, en el orden reintentable de la purga del expediente: primero sus documentos de
 * Storage, mientras sus rutas siguen en la BD; después la BD, que vuelve a mirar que siga vencida.
 * Si Storage falla, no se toca la BD: borrar la fila perdería la ruta, y el documento se quedaría
 * para siempre sin nadie que lo encuentre. `false` si la BD ya no la destruye. Exportada para su
 * test.
 */
export async function destruirUna(service: Service, v: Vencida): Promise<boolean> {
  for (const [bucket, paths] of [
    [BUCKET_MANDATO_SEPA, v.mandatos],
    [BUCKET_DNI_TUTORES, v.dnis],
  ] as const) {
    if (paths.length === 0) continue
    const { error } = await service.storage.from(bucket).remove(paths)
    if (error) throw new Error(`Storage ${bucket}: ${error.message}`)
  }

  const { data, error } = await service.rpc('destruir_fiscal_familia', {
    p_familia_id: v.familia_id,
    p_anios: ANIOS_FISCAL,
  })
  if (error) throw new Error(`destruir_fiscal_familia falló: ${error.message}`)
  return data !== null
}
