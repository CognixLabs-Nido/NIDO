'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import { borrarObjetosBucket } from '@/shared/lib/adjuntos/storage'

import { FUENTES_RETENCION } from '../lib/fuentes-retencion'
import { ok, type ActionResult, type ResultadoBarrido } from '../types'

/**
 * Barrido de retención POR TIEMPO (A6, Decisión #12). Recorre el manifiesto
 * declarativo de fuentes; por cada unidad vencida registra la ejecución en
 * `retencion_ejecuciones` (append-only, D6) y —solo si NO es dry-run— borra los
 * objetos de Storage y aplica la limpieza de BD de la fuente.
 *
 * `dryRun` (D4): por defecto SOLO registra lo que purgaría ('simulado'), sin
 * borrar. Tras verificar el predicado en producción se pasa a borrado autónomo
 * ('purgado') con `RETENCION_DRY_RUN=false`.
 *
 * Idempotente y reintentable: el predicado se re-deriva en cada pasada y
 * `storage.remove` es no-op si el objeto ya no existe; un fallo aislado no aborta
 * el resto. Reusa `borrarObjetosBucket` (A4) y service-role (bypass RLS).
 */
export async function barrerRetencion(opts: {
  dryRun: boolean
}): Promise<ActionResult<ResultadoBarrido>> {
  const { dryRun } = opts
  const service = await createServiceClient()

  let objetosPurgados = 0
  let fallidos = 0
  let total = 0
  const porCategoria: Record<string, number> = {}

  for (const fuente of FUENTES_RETENCION) {
    let unidades
    try {
      unidades = await fuente.listar(service, new Date().toISOString())
    } catch (e) {
      logger.error(
        'retencion: listar falló',
        fuente.nombre,
        e instanceof Error ? e.message : String(e)
      )
      continue
    }

    for (const u of unidades) {
      total++
      try {
        // Registro append-only (también en dry-run: deja constancia de lo que purgaría).
        await service.from('retencion_ejecuciones').insert({
          categoria: u.categoria,
          centro_id: u.centroId,
          ref_tipo: u.refTipo,
          ref_id: u.refId,
          bucket: u.bucket,
          objetos: u.paths.length,
          motivo: u.motivo,
          accion: dryRun ? 'simulado' : 'purgado',
        })

        if (!dryRun) {
          await borrarObjetosBucket(service, u.bucket, u.paths)
          await fuente.limpiarDb?.(service, u)
          objetosPurgados += u.paths.length
        }
        porCategoria[u.categoria] = (porCategoria[u.categoria] ?? 0) + 1
      } catch (e) {
        fallidos++
        logger.error(
          'retencion: purga de unidad falló (se reintentará)',
          fuente.nombre,
          u.refId,
          e instanceof Error ? e.message : String(e)
        )
      }
    }
  }

  return ok({ dryRun, total, objetosPurgados, fallidos, porCategoria })
}
