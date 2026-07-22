'use server'

import { revalidatePath } from 'next/cache'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { eurosACentimos } from '@/shared/lib/format-money'
import { logger } from '@/shared/lib/logger'

import {
  tarifaConceptoAnioSchema,
  type TarifaConceptoAnioInput,
} from '../schemas/tarifa-concepto-anio'

const RUTA = '/[locale]/admin/cuotas'

/**
 * B1-2: crea o edita la tarifa por año de nacimiento de un concepto (upsert por el UNIQUE
 * (concepto_id, anio_nacimiento) de B1-0). `importe` se guarda en CÉNTIMOS. `centro_id` sale
 * de `getCentroActualId()`: la RLS exige `es_admin(centro_id) AND centro_de_concepto(
 * concepto_id) = centro_id`, así que un cruce de centro lo rechaza la BD (42501). Solo admin.
 *
 * La tarifa NO toca recibos ya generados: el motor (B1-1) la aplica al (RE)GENERAR el mes.
 */
export async function guardarTarifaConceptoAnio(
  input: TarifaConceptoAnioInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = tarifaConceptoAnioSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'conceptos_cobro.tarifa_anio.validation.invalid')
  }

  const centroId = await getCentroActualId()
  if (!centroId) return fail('conceptos_cobro.errors.no_autorizado')

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tarifa_concepto_anio')
    .upsert(
      {
        centro_id: centroId,
        concepto_id: parsed.data.concepto_id,
        anio_nacimiento: parsed.data.anio_nacimiento,
        importe_centimos: eurosACentimos(parsed.data.importe_euros),
      },
      { onConflict: 'concepto_id,anio_nacimiento' }
    )
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('guardarTarifaConceptoAnio error', error?.message)
    if (error?.code === '42501') return fail('conceptos_cobro.errors.no_autorizado')
    return fail('conceptos_cobro.tarifa_anio.errors.save_failed')
  }

  revalidatePath(RUTA, 'page')
  return ok({ id: data.id })
}

/**
 * B1-2: borra la tarifa por año de un concepto. La tabla NO tiene `deleted_at` → DELETE real
 * (la RLS admin lo permite). Solo admin (RLS).
 */
export async function eliminarTarifaConceptoAnio(input: {
  concepto_id: string
  anio_nacimiento: number
}): Promise<ActionResult<void>> {
  const centroId = await getCentroActualId()
  if (!centroId) return fail('conceptos_cobro.errors.no_autorizado')

  const supabase = await createClient()
  const { error } = await supabase
    .from('tarifa_concepto_anio')
    .delete()
    .eq('centro_id', centroId)
    .eq('concepto_id', input.concepto_id)
    .eq('anio_nacimiento', input.anio_nacimiento)

  if (error) {
    logger.warn('eliminarTarifaConceptoAnio error', error.message)
    if (error.code === '42501') return fail('conceptos_cobro.errors.no_autorizado')
    return fail('conceptos_cobro.tarifa_anio.errors.delete_failed')
  }

  revalidatePath(RUTA, 'page')
  return ok(undefined)
}
