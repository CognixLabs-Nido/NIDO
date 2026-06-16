'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { actualizarNinoTutorSchema, type ActualizarNinoTutorInput } from '../schemas/nino'

import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * Pieza 3a — el TUTOR escribe la identidad de su hijo (apellidos, fecha_nacimiento,
 * sexo, nacionalidad, idioma_principal) vía la RPC `actualizar_identidad_nino_tutor`
 * (SECURITY DEFINER, gate `es_tutor_de`, whitelist de columnas). Nunca `UPDATE`
 * directo a `ninos`: la RPC impide tocar aula/centro/flags/notas_admin. NULL=preservar.
 */
export async function actualizarNinoTutor(
  input: ActualizarNinoTutorInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = actualizarNinoTutorSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'nino.validation.invalid')
  }

  const d = parsed.data
  const supabase = await createClient()
  // El tipo generado declara los args como no-nullable, pero la RPC acepta NULL
  // (contrato "NULL = preservar"). Mismo patrón que `crearNinoCompleto`.
  const rpcArgs = {
    p_nino_id: d.nino_id,
    p_apellidos: d.apellidos,
    p_fecha_nacimiento: d.fecha_nacimiento,
    p_sexo: d.sexo ?? null,
    p_nacionalidad: d.nacionalidad ?? null,
    p_idioma_principal: d.idioma_principal,
  } as unknown as {
    p_nino_id: string
    p_apellidos: string
    p_fecha_nacimiento: string
    p_sexo: 'F' | 'M' | 'X'
    p_nacionalidad: string
    p_idioma_principal: string
  }

  const { data, error } = await supabase.rpc('actualizar_identidad_nino_tutor', rpcArgs)
  if (error) {
    logger.warn('actualizarNinoTutor', error.message)
    if (error.code === '42501') return fail('nino.errors.no_autorizado')
    return fail('nino.errors.guardar_fallo')
  }
  if (!data) return fail('nino.errors.guardar_fallo')
  return ok({ id: data as string })
}
