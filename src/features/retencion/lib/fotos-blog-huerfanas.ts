import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { logger } from '@/shared/lib/logger'

import { BUCKET_AULA_FOTOS } from '@/features/fotos/types'

export interface ResultadoFotosBlogHuerfanas {
  /** En simulación solo se cuentan: no se borra nada. */
  dryRun: boolean
  /** Fotos del blog que ninguna fila de `media` nombra, de más de un día. NULL si no se pudieron listar. */
  huerfanas: number | null
  /** Borradas (0 en simulación). */
  borradas: number
  /** Las que fallaron: siguen y se reintentan en la siguiente pasada. */
  fallidas: number
}

/**
 * Las fotos del bucket del blog (`aula-fotos`) que ninguna fila de `media` nombra (censo C, decisión de
 * Jose del 2026-11-25): la red de «primero el fichero, después la fila». Borrar una publicación o una
 * foto ya no deja huérfanos; los deja la subida que inserta la fila, falla al subir y no consigue
 * borrar lo que sí subió, y lo que dejó el orden de antes. La lista la da la base
 * (`aula_fotos_huerfanas`, de más de un día), como la del mandato. Respeta la simulación del cron.
 */
export async function barrerFotosBlogHuerfanas(opts: {
  dryRun: boolean
}): Promise<ResultadoFotosBlogHuerfanas> {
  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('aula_fotos_huerfanas')
  const lista = !error && Array.isArray(data) ? data : null
  if (!lista) logger.error('retención: fotos huérfanas del blog', error?.message ?? 'sin forma')
  const r: ResultadoFotosBlogHuerfanas = {
    dryRun: opts.dryRun,
    huerfanas: lista?.length ?? null,
    borradas: 0,
    fallidas: 0,
  }
  if (opts.dryRun || !lista) return r

  // `storage.objects.name` admite NULL: lo que no tiene ruta no se puede borrar por ella.
  const rutas = lista.map((h) => h.ruta).filter((ruta): ruta is string => ruta !== null)
  for (let i = 0; i < rutas.length; i += 100) {
    const lote = rutas.slice(i, i + 100)
    const { error: errBorrar } = await service.storage.from(BUCKET_AULA_FOTOS).remove(lote)
    if (errBorrar) {
      r.fallidas += lote.length
      logger.error('retención: fotos huérfanas del blog (se reintentará)', errBorrar.message)
    } else {
      r.borradas += lote.length
    }
  }
  return r
}
