'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { infoMedicaTutorSchema, type InfoMedicaTutorInput } from '../schemas/nino'

import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * Pieza 3a — el TUTOR escribe la info médica de su hijo (+ ruta de cartilla) vía la
 * RPC `set_info_medica_emergencia_cifrada_tutor` (SECURITY DEFINER). La RPC gatea con
 * `es_tutor_de(nino_id) AND tiene_consentimiento(auth.uid(),'datos_medicos')` y cifra
 * en servidor sin exponer la clave de Vault. NULL = preservar (ADR-0004). Si no hay
 * consentimiento vigente, la RPC lanza `insufficient_privilege` (42501).
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
  // (contrato "NULL = preservar"). Mismo patrón que `crearNinoCompleto`.
  const rpcArgs = {
    p_nino_id: d.nino_id,
    p_alergias_graves: d.alergias_graves ?? null,
    p_notas_emergencia: d.notas_emergencia ?? null,
    p_medicacion_habitual: d.medicacion_habitual ?? null,
    p_alergias_leves: d.alergias_leves ?? null,
    p_medico_familia: d.medico_familia ?? null,
    p_telefono_emergencia: d.telefono_emergencia ?? null,
    p_cartilla_vacunas_path: d.cartilla_vacunas_path ?? null,
  } as unknown as {
    p_nino_id: string
    p_alergias_graves: string
    p_notas_emergencia: string
    p_medicacion_habitual: string
    p_alergias_leves: string
    p_medico_familia: string
    p_telefono_emergencia: string
    p_cartilla_vacunas_path: string
  }

  const { data, error } = await supabase.rpc('set_info_medica_emergencia_cifrada_tutor', rpcArgs)
  if (error) {
    logger.warn('guardarInfoMedicaTutor', error.message)
    // 42501 = sin consentimiento vigente o no es tutor del niño (gate de la RPC).
    if (error.code === '42501') return fail('nino.errors.medica_no_autorizado')
    return fail('nino.errors.guardar_fallo')
  }
  if (!data) return fail('nino.errors.guardar_fallo')
  return ok({ id: data as string })
}
