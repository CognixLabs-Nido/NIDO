'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { RecalculoResumen } from '../lib/resumen-recalculo'

const RUTA = '/[locale]/admin/cuotas'

const inputSchema = z.object({
  anio: z.number().int().min(2024).max(2100),
  mes: z.number().int().min(1).max(12),
})

/**
 * R-1: RECALCULAR EL MES desde la pestaña del panel. Encadena las dos RPC que ya existen
 * —`proponer_asignaciones` (siembra los conceptos automáticos de los niños que aún no los
 * tienen) y `generar_recibos_mes` (rehace los BORRADORES del mes)— y devuelve un recuento
 * REAL de lo que hizo cada una.
 *
 * Por qué existe: sembrar conceptos vivía en otra pestaña y había que acordarse de pulsarlo
 * antes de generar. Un niño matriculado después de la última pulsación se quedaba sin
 * conceptos y, al no tener ninguna línea, el motor descartaba su recibo entero — la familia
 * desaparecía del panel como "Sin cargos". Un hermano en esa situación era peor: no
 * desaparecía nada, el recibo familiar simplemente cobraba de menos en silencio.
 *
 * NO toca el motor (eso es R-2): solo lo invoca. Los recibos ya confirmados quedan intactos
 * porque `generar_recibos_mes` únicamente borra borradores y salta las familias que ya
 * tienen recibo; aquí se cuentan ANTES para poder afirmarlo en el aviso.
 */
export async function recalcularMes(input: {
  anio: number
  mes: number
}): Promise<ActionResult<RecalculoResumen>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return fail('recibos_panel.errors.invalid')
  const { anio, mes } = parsed.data

  const centroId = await getCentroActualId()
  if (!centroId) return fail('recibos_panel.errors.no_autorizado')

  const supabase = await createClient()

  // Un mes cerrado no se regenera. Se comprueba ANTES de sembrar para no dejar a medias
  // un recálculo que el motor va a rechazar de todos modos.
  const { data: cerrado, error: errorCerrado } = await supabase.rpc('mes_cerrado', {
    p_centro_id: centroId,
    p_anio: anio,
    p_mes: mes,
  })
  if (errorCerrado) {
    logger.warn('recalcularMes mes_cerrado error', errorCerrado.message)
    return fail('recibos_panel.errors.generar_failed')
  }
  if (cerrado) return fail('recibos_panel.errors.mes_cerrado')

  // Confirmados del mes ANTES de tocar nada: son los que el aviso promete no tocar.
  const { count: confirmadosIntactos, error: errorConfirmados } = await supabase
    .from('recibos')
    .select('id', { count: 'exact', head: true })
    .eq('centro_id', centroId)
    .eq('anio', anio)
    .eq('mes', mes)
    .eq('es_esporadico', false)
    .is('devuelto_de_recibo_id', null)
    .is('deleted_at', null)
    .neq('estado', 'borrador')
  if (errorConfirmados) {
    logger.warn('recalcularMes contar confirmados error', errorConfirmados.message)
    return fail('recibos_panel.errors.generar_failed')
  }

  // Foto de las asignaciones VIVAS antes de sembrar. El diff contra la foto de después es
  // la única forma exacta de saber a cuántos niños se les sembró: la RPC devuelve el total
  // de filas, no a quién. `proponer_asignaciones` nunca revive bajas manuales (para eso
  // está `reproponer`), así que toda fila nueva del diff es una alta real.
  const { data: antes, error: errorAntes } = await supabase
    .from('asignacion_concepto')
    .select('id')
    .eq('centro_id', centroId)
    .is('deleted_at', null)
  if (errorAntes) {
    logger.warn('recalcularMes foto previa error', errorAntes.message)
    return fail('cuotas_config.errors.proponer_failed')
  }
  const idsAntes = new Set(antes.map((a) => a.id))

  const { data: sembradas, error: errorProponer } = await supabase.rpc('proponer_asignaciones', {
    p_centro_id: centroId,
  })
  if (errorProponer || sembradas === null) {
    logger.warn('recalcularMes proponer error', errorProponer?.message)
    if (errorProponer?.code === '42501') return fail('recibos_panel.errors.no_autorizado')
    return fail('cuotas_config.errors.proponer_failed')
  }

  const { data: despues, error: errorDespues } = await supabase
    .from('asignacion_concepto')
    .select('id, nino_id, familia_id')
    .eq('centro_id', centroId)
    .is('deleted_at', null)
  if (errorDespues) {
    logger.warn('recalcularMes foto posterior error', errorDespues.message)
    return fail('cuotas_config.errors.proponer_failed')
  }
  const nuevas = despues.filter((a) => !idsAntes.has(a.id))
  const ninosAfectados = new Set(nuevas.map((a) => a.nino_id).filter(Boolean)).size
  const familiasAfectadas = new Set(nuevas.map((a) => a.familia_id).filter(Boolean)).size

  const { data: recibosRegenerados, error: errorGenerar } = await supabase.rpc(
    'generar_recibos_mes',
    { p_centro_id: centroId, p_anio: anio, p_mes: mes }
  )
  if (errorGenerar || recibosRegenerados === null) {
    logger.warn('recalcularMes generar error', errorGenerar?.message)
    if (errorGenerar?.code === '42501') return fail('recibos_panel.errors.no_autorizado')
    if (errorGenerar?.code === 'P0001') return fail('recibos_panel.errors.mes_cerrado')
    return fail('recibos_panel.errors.generar_failed')
  }

  revalidatePath(RUTA, 'page')
  return ok({
    conceptosSembrados: sembradas,
    ninosAfectados,
    familiasAfectadas,
    recibosRegenerados,
    confirmadosIntactos: confirmadosIntactos ?? 0,
  })
}
