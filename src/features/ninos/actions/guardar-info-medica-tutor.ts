'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { infoMedicaTutorSchema, type InfoMedicaTutorInput } from '../schemas/nino'

import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * Pieza 3a — el TUTOR escribe la info médica de su hijo vía la RPC
 * `set_info_medica_emergencia_cifrada_tutor` (SECURITY DEFINER). La RPC gatea solo con
 * `es_tutor_legal_de(nino_id)` y cifra en servidor sin exponer la clave de Vault.
 * NULL = preservar (ADR-0004). La info médica es VOLUNTARIA (F11-F): sin gate de
 * consentimiento. Si el llamante no es tutor legal, la RPC lanza 42501.
 */
export async function guardarInfoMedicaTutor(
  input: InfoMedicaTutorInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = infoMedicaTutorSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'nino.validation.invalid')
  }

  const d = parsed.data
  const supabase = await createClient()
  // El tipo generado declara los args como no-nullable, pero la RPC acepta NULL
  // (contrato "NULL = preservar" del setter médico).
  const rpcArgs = {
    p_nino_id: d.nino_id,
    p_alergias_graves: d.alergias_graves ?? null,
    p_notas_emergencia: d.notas_emergencia ?? null,
    p_medicacion_habitual: d.medicacion_habitual ?? null,
    p_alergias_leves: d.alergias_leves ?? null,
    p_medico_familia: d.medico_familia ?? null,
    p_telefono_emergencia: d.telefono_emergencia ?? null,
  } as unknown as {
    p_nino_id: string
    p_alergias_graves: string
    p_notas_emergencia: string
    p_medicacion_habitual: string
    p_alergias_leves: string
    p_medico_familia: string
    p_telefono_emergencia: string
  }

  const { data, error } = await supabase.rpc('set_info_medica_emergencia_cifrada_tutor', rpcArgs)
  if (error) {
    logger.warn('guardarInfoMedicaTutor', error.message)
    // 42501 = no es tutor legal del niño (gate de la RPC).
    if (error.code === '42501') return fail('nino.errors.medica_no_autorizado')
    return fail('nino.errors.guardar_fallo')
  }
  if (!data) return fail('nino.errors.guardar_fallo')
  return ok({ id: data as string })
}
