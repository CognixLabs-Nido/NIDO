import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { recolectarAdjuntosDe } from '@/features/olvido/lib/fuentes-adjuntos'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { borrarObjetosBucket } from '@/shared/lib/adjuntos/storage'
import { logger } from '@/shared/lib/logger'

import type { Database } from '@/types/database'

import { RETENCION_EXPEDIENTE_ANIOS } from '../types'

type Service = SupabaseClient<Database>
type Vencido = Database['public']['Functions']['expedientes_vencidos']['Returns'][number]

export interface ResultadoExpediente {
  /** En simulación solo se cuentan: no se borra nada. */
  dryRun: boolean
  /** Niños de baja con el expediente vencido. NULL si no se pudieron listar. */
  vencidos: number | null
  /** Purgados (0 en simulación). */
  purgados: number
  /** Los que fallaron: siguen de baja y se reintentan en la siguiente pasada. */
  fallidos: number
}

/**
 * Purga el expediente de los niños de baja al vencer su plazo provisional
 * (`RETENCION_EXPEDIENTE_ANIOS`) desde la baja (20261204120000). Es la purga del olvido, sin
 * solicitud y sin avisos. Respeta la simulación del cron (`RETENCION_DRY_RUN`). Un fallo no tumba
 * el resto del cron: se registra y se cuenta.
 */
export async function purgarExpedientes(opts: { dryRun: boolean }): Promise<ResultadoExpediente> {
  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('expedientes_vencidos', {
    p_anios: RETENCION_EXPEDIENTE_ANIOS,
  })
  if (error || !Array.isArray(data)) {
    logger.error('retención: expediente', error?.message ?? 'respuesta sin la forma esperada')
    return { dryRun: opts.dryRun, vencidos: null, purgados: 0, fallidos: 0 }
  }
  if (opts.dryRun) return { dryRun: true, vencidos: data.length, purgados: 0, fallidos: 0 }

  let purgados = 0
  let fallidos = 0
  for (const v of data) {
    try {
      if (await purgarUno(service, v)) purgados++
    } catch (e) {
      fallidos++
      logger.error(
        'retención: expediente de un niño falló (se reintentará)',
        v.nino_id,
        e instanceof Error ? e.message : String(e)
      )
    }
  }
  return { dryRun: false, vencidos: data.length, purgados, fallidos }
}

/**
 * Purga un niño en el orden reintentable del olvido (`purgarUno` de purgar-vencidos.ts): primero
 * sus ficheros de Storage, con el mismo manifiesto, mientras sus rutas siguen en la BD; después
 * la BD, que vuelve a mirar que siga vencido. Si falla a medias, sigue de baja y se repite.
 * Exportada para su test.
 */
export async function purgarUno(service: Service, v: Vencido): Promise<boolean> {
  const porBucket = await recolectarAdjuntosDe(
    service,
    { sujeto_tipo: 'nino', sujeto_id: v.nino_id, centro_id: v.centro_id },
    true
  )
  for (const [bucket, paths] of porBucket) {
    await borrarObjetosBucket(service, bucket, paths)
  }

  const { data, error } = await service.rpc('purgar_expediente_nino', {
    p_nino_id: v.nino_id,
    p_anios: RETENCION_EXPEDIENTE_ANIOS,
  })
  if (error) throw new Error(`purgar_expediente_nino falló: ${error.message}`)
  return data === true
}
