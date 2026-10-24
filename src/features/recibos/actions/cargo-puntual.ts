'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { cargoPuntualSchema, filaCargoSchema, type CargoPuntualInput } from '../lib/cargo-puntual'
import type { FilaCargo } from '../lib/cargo-puntual'

const RUTA = '/[locale]/admin/cuotas'

/**
 * PR-13: un cargo puntual (una excursión, por ejemplo) a varios niños de golpe. Cada niño recibe
 * una línea manual en el recibo del mes de su familia; la familia con el recibo ya validado no se
 * toca y sale «no incluida». Todo en una transacción (`anadir_cargo_puntual`), con la sesión de
 * Dirección: la RLS y el congelado por estado siguen mandando.
 */
export async function anadirCargoPuntual(
  input: CargoPuntualInput
): Promise<ActionResult<{ filas: FilaCargo[] }>> {
  const parsed = cargoPuntualSchema.safeParse(input)
  if (!parsed.success) {
    const motivo = parsed.error.issues[0]?.message
    return fail(motivo?.startsWith('cargo_puntual.') ? motivo : 'cargo_puntual.errors.invalido')
  }
  const d = parsed.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anadir_cargo_puntual', {
    p_centro_id: d.centroId,
    p_anio: d.anio,
    p_mes: d.mes,
    p_nino_ids: d.ninoIds,
    p_descripcion: d.descripcion,
    p_importe_centimos: d.importeCentimos,
    p_concepto_id: d.conceptoId ?? undefined,
  })
  if (error) {
    logger.warn('anadirCargoPuntual', error.message)
    if (error.code === '42501') return fail('recibos_panel.errors.no_autorizado')
    if (error.code === 'P0001' && error.message.includes('mes_cerrado_x')) {
      return fail('cargo_puntual.errors.mes_cerrado')
    }
    // Otra persona creó a la vez el recibo de una de las familias (generar el mes, por ejemplo).
    if (error.code === '23505') return fail('cargo_puntual.errors.a_la_vez')
    if (error.code === '22023') return fail('cargo_puntual.errors.invalido')
    return fail('cargo_puntual.errors.failed')
  }

  revalidatePath(RUTA, 'page')

  // El cargo ya está guardado: si la respuesta no se entiende, se dice así, no «ha fallado».
  const filas = z.array(filaCargoSchema).safeParse(data)
  if (!filas.success) {
    logger.error('anadirCargoPuntual respuesta', filas.error.message)
    return fail('cargo_puntual.errors.sin_resumen')
  }
  return ok({ filas: filas.data })
}
