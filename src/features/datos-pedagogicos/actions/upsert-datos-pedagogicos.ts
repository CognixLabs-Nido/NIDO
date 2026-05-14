'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import {
  datosPedagogicosInputSchema,
  type DatosPedagogicosInput,
} from '../schemas/datos-pedagogicos'
import { fail, ok, type ActionResult } from '../../centros/types'

interface UpsertResult {
  id: string
}

/**
 * Crea o actualiza los datos pedagógicos de un niño. RLS asegura que solo
 * un admin del centro puede llamarla con éxito. La UPSERT vía
 * `onConflict: nino_id` significa que la action es idempotente: el form
 * envía el estado completo y la BD termina con esa fila.
 */
export async function upsertDatosPedagogicos(
  locale: string,
  input: DatosPedagogicosInput
): Promise<ActionResult<UpsertResult>> {
  const parsed = datosPedagogicosInputSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'pedagogico.validation.invalid')
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('datos_pedagogicos_nino')
    .upsert(
      {
        nino_id: parsed.data.nino_id,
        lactancia_estado: parsed.data.lactancia_estado,
        lactancia_observaciones: parsed.data.lactancia_observaciones ?? null,
        control_esfinteres: parsed.data.control_esfinteres,
        control_esfinteres_observaciones: parsed.data.control_esfinteres_observaciones ?? null,
        siesta_horario_habitual: parsed.data.siesta_horario_habitual ?? null,
        siesta_numero_diario: parsed.data.siesta_numero_diario ?? null,
        siesta_observaciones: parsed.data.siesta_observaciones ?? null,
        tipo_alimentacion: parsed.data.tipo_alimentacion,
        alimentacion_observaciones: parsed.data.alimentacion_observaciones ?? null,
        idiomas_casa: parsed.data.idiomas_casa,
        tiene_hermanos_en_centro: parsed.data.tiene_hermanos_en_centro,
      },
      { onConflict: 'nino_id' }
    )
    .select('id')
    .single()

  if (error || !data) {
    logger.warn('upsertDatosPedagogicos failed', error?.message)
    return fail('pedagogico.errors.guardar_fallo')
  }

  revalidatePath(`/${locale}/admin/ninos/${parsed.data.nino_id}`)
  return ok({ id: data.id })
}
