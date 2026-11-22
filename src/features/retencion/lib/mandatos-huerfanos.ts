import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { BUCKET_MANDATO_SEPA } from '@/shared/lib/adjuntos/storage'
import { logger } from '@/shared/lib/logger'

export interface ResultadoMandatosHuerfanos {
  /** En simulación solo se cuentan: no se borra nada. */
  dryRun: boolean
  /** Ficheros del bucket que ninguna fila nombra, de más de un día. NULL si no se pudieron listar. */
  huerfanos: number | null
  /** Borrados (0 en simulación). */
  borrados: number
  /** Los que fallaron: siguen y se reintentan en la siguiente pasada. */
  fallidos: number
}

/**
 * Los ficheros del bucket `mandato-sepa` que ninguna fila de `mandatos_sepa` nombra (decisión del
 * 2026-11-22, cierre del mandato: «Un huérfano con un IBAN dentro que nadie busca es justo lo que no
 * queremos»). Salen de una firma cuyo registro no entró y cuyo borrado inmediato falló
 * (`firmarMandatoDigital`): no son prueba de nada, porque solo cuenta el fichero que la fila nombra.
 * La lista la da la base (`mandatos_sepa_huerfanos`, de más de un día, para no coger una firma en
 * curso), como los ficheros de remesa sin registro. Respeta la simulación del cron.
 */
export async function barrerMandatosHuerfanos(opts: {
  dryRun: boolean
}): Promise<ResultadoMandatosHuerfanos> {
  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('mandatos_sepa_huerfanos')
  const lista = !error && Array.isArray(data) ? data : null
  if (!lista) logger.error('retención: huérfanos del mandato', error?.message ?? 'sin forma')
  const r: ResultadoMandatosHuerfanos = {
    dryRun: opts.dryRun,
    huerfanos: lista?.length ?? null,
    borrados: 0,
    fallidos: 0,
  }
  if (opts.dryRun || !lista) return r

  // `storage.objects.name` admite NULL: lo que no tiene ruta no se puede borrar por ella.
  const rutas = lista.map((h) => h.ruta).filter((ruta): ruta is string => ruta !== null)
  for (let i = 0; i < rutas.length; i += 100) {
    const lote = rutas.slice(i, i + 100)
    const { error: errBorrar } = await service.storage.from(BUCKET_MANDATO_SEPA).remove(lote)
    if (errBorrar) {
      r.fallidos += lote.length
      logger.error('retención: huérfanos del mandato (se reintentará)', errBorrar.message)
    } else {
      r.borrados += lote.length
    }
  }
  return r
}
