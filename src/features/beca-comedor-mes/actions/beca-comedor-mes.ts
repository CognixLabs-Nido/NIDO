'use server'

import { revalidatePath } from 'next/cache'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { becaComedorMesSchema, type BecaComedorMesInput } from '../schemas/beca-comedor-mes'

const RUTA = '/[locale]/admin/cuotas'

/**
 * D-6-3: crea o edita la beca comedor de un niño para un mes (upsert por el UNIQUE
 * (nino_id, anio, mes) de D-6-1). `importe` se guarda en EUROS directos. `centro_id` sale
 * de `getCentroActualId()`: la RLS exige `es_admin(centro_id) AND centro_de_nino(nino_id) =
 * centro_id`, así que un cruce de centro lo rechaza la BD (42501). Solo admin (RLS).
 *
 * La beca NO toca recibos ya generados: se refleja al (RE)GENERAR los recibos del mes.
 */
export async function guardarBecaComedorMes(
  input: BecaComedorMesInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = becaComedorMesSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'admin.cuotas.beca_comedor.validation.invalid')
  }

  const centroId = await getCentroActualId()
  if (!centroId) return fail('admin.cuotas.beca_comedor.errors.no_autorizado')

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('beca_comedor_mes')
    .upsert(
      {
        centro_id: centroId,
        nino_id: parsed.data.nino_id,
        anio: parsed.data.anio,
        mes: parsed.data.mes,
        importe: parsed.data.importe_euros,
      },
      { onConflict: 'nino_id,anio,mes' }
    )
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('guardarBecaComedorMes error', error?.message)
    if (error?.code === '42501') return fail('admin.cuotas.beca_comedor.errors.no_autorizado')
    return fail('admin.cuotas.beca_comedor.errors.save_failed')
  }

  revalidatePath(RUTA, 'page')
  return ok({ id: data.id })
}

/**
 * D-6-3: borra la beca comedor de un niño para un mes. La tabla NO tiene `deleted_at` →
 * DELETE real (la RLS admin lo permite). Solo admin (RLS).
 */
export async function eliminarBecaComedorMes(input: {
  nino_id: string
  anio: number
  mes: number
}): Promise<ActionResult<void>> {
  const centroId = await getCentroActualId()
  if (!centroId) return fail('admin.cuotas.beca_comedor.errors.no_autorizado')

  const supabase = await createClient()
  const { error } = await supabase
    .from('beca_comedor_mes')
    .delete()
    .eq('centro_id', centroId)
    .eq('nino_id', input.nino_id)
    .eq('anio', input.anio)
    .eq('mes', input.mes)

  if (error) {
    logger.warn('eliminarBecaComedorMes error', error.message)
    if (error.code === '42501') return fail('admin.cuotas.beca_comedor.errors.no_autorizado')
    return fail('admin.cuotas.beca_comedor.errors.delete_failed')
  }

  revalidatePath(RUTA, 'page')
  return ok(undefined)
}
