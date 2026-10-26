import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { COLUMNAS_RECIBO_HISTORIAL, enriquecerHistorial } from './enriquecer-historial'

import type { FiltroHistorial } from '../lib/filtro-historial'
import type { ReciboHistorial } from '../lib/historial-familia'

/** Recibos por página. Con un centro lleno son miles: se pagina en la BD, nunca en memoria. */
export const RECIBOS_POR_PAGINA = 50

export interface ReciboHistorialGeneral extends ReciboHistorial {
  familiaEtiqueta: string | null
}

export type HistorialGeneralResult =
  | {
      ok: true
      recibos: ReciboHistorialGeneral[]
      total: number
      /** La página servida: la pedida, o la última si se pidió una que no existe. */
      pagina: number
      paginas: number
    }
  | { ok: false }

/**
 * Histórico general de recibos del centro para Dirección (F-6): todos los recibos vivos, también los
 * borradores, del más reciente al más antiguo, filtrados por año, mes, familia y niño, de 50 en 50.
 *
 * - Por niño: los recibos con alguna línea suya (los regulares de su familia que le cobran algo) y
 *   los esporádicos cargados a él (`recibos.nino_id`).
 * - Primero se cuentan y después se lee la página, así una página fuera de rango no se pide: se sirve
 *   la última. Las dos lecturas van por `idx_recibos_centro_periodo` (o el de familia, o el de
 *   niño de `lineas_recibo`); medido con 28 100 recibos: la última página, 31 ms; el recuento, 7 ms.
 * - Cada recibo con lo que pasó al cobrarlo (`enriquecerHistorial`), también cuando su enlace cae en
 *   otra página.
 *
 * RLS: Dirección del centro. El centro lo fija la página (`requireContextoCentro`).
 */
export async function getHistorialRecibosGeneral(
  centroId: string,
  filtro: FiltroHistorial
): Promise<HistorialGeneralResult> {
  const supabase = await createClient()

  // Por niño: los recibos con alguna línea suya, además de los esporádicos cargados a él.
  let recibosDelNino: string[] = []
  if (filtro.ninoId) {
    const { data, error } = await supabase
      .from('lineas_recibo')
      .select('recibo_id')
      .eq('centro_id', centroId)
      .eq('nino_id', filtro.ninoId)
    if (error) return fallar('lineas del niño', error.message)
    recibosDelNino = [...new Set((data ?? []).map((l) => l.recibo_id))]
  }

  // El mismo filtro para contar y para leer la página: el centro y los vivos en cada cadena, y lo
  // demás en un objeto común (`match`) y, por niño, un `or`.
  const iguales: Record<string, string | number> = {}
  if (filtro.anio) iguales.anio = filtro.anio
  if (filtro.mes) iguales.mes = filtro.mes
  if (filtro.familiaId) iguales.familia_id = filtro.familiaId
  const delNino = filtro.ninoId
    ? recibosDelNino.length > 0
      ? `nino_id.eq.${filtro.ninoId},id.in.(${recibosDelNino.join(',')})`
      : `nino_id.eq.${filtro.ninoId}`
    : null

  let consultaTotal = supabase
    .from('recibos')
    .select('id', { count: 'exact', head: true })
    .eq('centro_id', centroId)
    .is('deleted_at', null)
    .match(iguales)
  if (delNino) consultaTotal = consultaTotal.or(delNino)
  const { count, error: errCount } = await consultaTotal
  if (errCount) return fallar('recuento', errCount.message)
  const total = count ?? 0
  const paginas = Math.max(1, Math.ceil(total / RECIBOS_POR_PAGINA))
  const pagina = Math.min(Math.max(1, filtro.pagina), paginas)
  if (total === 0) return { ok: true, recibos: [], total, pagina, paginas }

  const desde = (pagina - 1) * RECIBOS_POR_PAGINA
  let consultaPagina = supabase
    .from('recibos')
    .select(COLUMNAS_RECIBO_HISTORIAL)
    .eq('centro_id', centroId)
    .is('deleted_at', null)
    .match(iguales)
  if (delNino) consultaPagina = consultaPagina.or(delNino)
  const { data: recibos, error } = await consultaPagina
    .order('anio', { ascending: false })
    .order('mes', { ascending: false })
    .order('es_esporadico', { ascending: true })
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(desde, desde + RECIBOS_POR_PAGINA - 1)
  if (error) return fallar('página', error.message)

  const familiaIds = [
    ...new Set((recibos ?? []).map((r) => r.familia_id).filter((x): x is string => x != null)),
  ]
  const [historial, familiasRes] = await Promise.all([
    enriquecerHistorial(supabase, centroId, recibos ?? []),
    familiaIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ id: string; etiqueta: string | null }>, error: null })
      : supabase
          .from('familias')
          .select('id, etiqueta')
          .eq('centro_id', centroId)
          .in('id', familiaIds),
  ])
  if (!historial) return { ok: false }
  if (familiasRes.error) return fallar('familias', familiasRes.error.message)
  const etiquetaPorFamilia = new Map((familiasRes.data ?? []).map((f) => [f.id, f.etiqueta]))

  return {
    ok: true,
    recibos: historial.map((h) => ({
      ...h,
      familiaEtiqueta: h.familiaId ? (etiquetaPorFamilia.get(h.familiaId) ?? null) : null,
    })),
    total,
    pagina,
    paginas,
  }
}

function fallar(paso: string, mensaje: string): { ok: false } {
  logger.warn(`getHistorialRecibosGeneral ${paso}`, mensaje)
  return { ok: false }
}
