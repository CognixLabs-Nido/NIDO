'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { infoMedicaTutorSchema, type InfoMedicaTutorInput } from '../schemas/nino'

import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F11-F3 — el TUTOR LEGAL edita/re-añade la info médica de su hijo DESPUÉS del alta,
 * desde la ficha `/family/nino/[id]`. Misma RPC que el wizard
 * (`set_info_medica_emergencia_cifrada_tutor`, gate solo `es_tutor_legal_de`) pero en
 * modo **REPLACE** (`p_reemplazar=true`): "lo que se ve es lo que se guarda".
 *
 * Diferencia clave con `guardarInfoMedicaTutor` (wizard, modo MERGE): aquí cada campo
 * es autoritativo. El form envía string vacío para un campo borrado; lo normalizamos a
 * NULL para que el modo REPLACE lo LIMPIE (en MERGE, NULL preservaría). El wizard NO se
 * toca: sigue llamando sin el flag → `p_reemplazar` cae a su DEFAULT false → MERGE.
 *
 * No re-pide acuse de confidencialidad: es informativo y ya está en registro (el acuse
 * vive en el cierre del alta, no en la escritura médica).
 */
export async function editarInfoMedicaTutor(
  input: InfoMedicaTutorInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = infoMedicaTutorSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'nino.validation.invalid')
  }

  const d = parsed.data
  // REPLACE: string vacío/undefined → NULL = limpiar el campo. Cada campo es
  // autoritativo (no hay "preservar"); el form refleja el estado completo.
  const limpiar = (v: string | null | undefined): string | null =>
    v == null || v.trim() === '' ? null : v

  const supabase = await createClient()
  const rpcArgs = {
    p_nino_id: d.nino_id,
    p_alergias_graves: limpiar(d.alergias_graves),
    p_notas_emergencia: limpiar(d.notas_emergencia),
    p_medicacion_habitual: limpiar(d.medicacion_habitual),
    p_alergias_leves: limpiar(d.alergias_leves),
    p_medico_familia: limpiar(d.medico_familia),
    p_telefono_emergencia: limpiar(d.telefono_emergencia),
    p_reemplazar: true,
  } as unknown as {
    p_nino_id: string
    p_alergias_graves: string
    p_notas_emergencia: string
    p_medicacion_habitual: string
    p_alergias_leves: string
    p_medico_familia: string
    p_telefono_emergencia: string
    p_reemplazar: boolean
  }

  const { data, error } = await supabase.rpc('set_info_medica_emergencia_cifrada_tutor', rpcArgs)
  if (error) {
    logger.warn('editarInfoMedicaTutor', error.message)
    // 42501 = no es tutor legal del niño (gate de la RPC).
    if (error.code === '42501') return fail('nino.errors.medica_no_autorizado')
    return fail('nino.errors.guardar_fallo')
  }
  if (!data) return fail('nino.errors.guardar_fallo')
  return ok({ id: data as string })
}
