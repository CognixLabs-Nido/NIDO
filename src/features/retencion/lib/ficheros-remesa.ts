import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { BUCKET_REMESAS_FICHEROS } from '@/shared/lib/adjuntos/storage'
import { logger } from '@/shared/lib/logger'

import type { Database } from '@/types/database'

import { ANIOS_FISCAL } from './fiscal'

type Service = SupabaseClient<Database>

export interface ResultadoFicherosRemesa {
  /** En simulación solo se cuentan: no se borra nada. */
  dryRun: boolean
  /** Ficheros con el plazo fiscal cumplido y sin retener. NULL si no se pudieron listar. */
  vencidos: number | null
  /** Destruidos: el objeto de Storage y su registro (0 en simulación). */
  destruidos: number
  /** Objetos del bucket sin registro, de más de un día. NULL si no se pudieron listar. */
  huerfanos: number | null
  /** Huérfanos borrados (0 en simulación). */
  huerfanosBorrados: number
  /** Los que fallaron: siguen y se reintentan en la siguiente pasada. */
  fallidos: number
}

/**
 * Destruye el fichero de cada versión de una remesa a los `ANIOS_FISCAL` años de su marca (R-1,
 * `20261220120000`): el objeto de Storage, sus adeudos y su fila. El plazo es el fiscal, con la
 * misma constante que lo fiscal de la familia, nunca un número escrito aparte: el fichero lleva los
 * IBAN y es la prueba de lo que se pidió al banco. Espera a la retención de cualquier familia del
 * fichero. Va ANTES de `destruirFiscal`, que no destruye a una familia con un fichero vivo.
 *
 * Y borra los objetos del bucket que no tienen registro (una subida cuyo registro no entró): sin él,
 * un IBAN se quedaría sin plazo. Respeta la simulación del cron. Un fallo no tumba el resto.
 */
export async function destruirFicherosRemesa(opts: {
  dryRun: boolean
}): Promise<ResultadoFicherosRemesa> {
  const service = createServiceRoleClient()
  const [vencidos, huerfanos] = await Promise.all([
    service.rpc('ficheros_remesa_vencidos', { p_anios: ANIOS_FISCAL }),
    service.rpc('ficheros_remesa_huerfanos'),
  ])
  const listaV = !vencidos.error && Array.isArray(vencidos.data) ? vencidos.data : null
  const listaH = !huerfanos.error && Array.isArray(huerfanos.data) ? huerfanos.data : null
  if (!listaV) logger.error('retención: ficheros de remesa', vencidos.error?.message ?? 'sin forma')
  if (!listaH)
    logger.error('retención: huérfanos de remesa', huerfanos.error?.message ?? 'sin forma')

  const r: ResultadoFicherosRemesa = {
    dryRun: opts.dryRun,
    vencidos: listaV?.length ?? null,
    destruidos: 0,
    huerfanos: listaH?.length ?? null,
    huerfanosBorrados: 0,
    fallidos: 0,
  }
  if (opts.dryRun) return r

  for (const v of listaV ?? []) {
    try {
      if (await destruirUno(service, v.fichero_id, v.ruta)) r.destruidos++
    } catch (e) {
      r.fallidos++
      logger.error(
        'retención: un fichero de remesa falló (se reintentará)',
        v.fichero_id,
        e instanceof Error ? e.message : String(e)
      )
    }
  }

  const rutas = (listaH ?? []).map((h) => h.ruta)
  for (let i = 0; i < rutas.length; i += 100) {
    const lote = rutas.slice(i, i + 100)
    const { error } = await service.storage.from(BUCKET_REMESAS_FICHEROS).remove(lote)
    if (error) {
      r.fallidos += lote.length
      logger.error('retención: huérfanos de remesa (se reintentará)', error.message)
    } else {
      r.huerfanosBorrados += lote.length
    }
  }
  return r
}

/**
 * Uno, en el orden reintentable de lo fiscal: primero el objeto de Storage, mientras su ruta sigue
 * en la BD; después la BD, que vuelve a mirar el plazo y la retención. Si Storage falla, no se toca
 * la BD: borrar la fila perdería la ruta, y el fichero, con sus IBAN, se quedaría sin nadie que lo
 * encuentre. `false` si la BD ya no lo destruye. Exportada para su test.
 */
export async function destruirUno(
  service: Service,
  ficheroId: string,
  ruta: string
): Promise<boolean> {
  const { error: errS } = await service.storage.from(BUCKET_REMESAS_FICHEROS).remove([ruta])
  if (errS) throw new Error(`Storage ${BUCKET_REMESAS_FICHEROS}: ${errS.message}`)
  const { data, error } = await service.rpc('destruir_fichero_remesa', {
    p_fichero_id: ficheroId,
    p_anios: ANIOS_FISCAL,
  })
  if (error) throw new Error(`destruir_fichero_remesa falló: ${error.message}`)
  return data !== null
}
