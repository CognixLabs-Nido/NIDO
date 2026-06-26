'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { guardarDatosTutorSchema, type GuardarDatosTutorInput } from '../schemas/alta-documentos'

import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F11-G — upsert de `datos_tutor` (identidad + dirección) en el alta. tutor 1 =
 * `tutor_legal_principal` (lo rellena el titular de la cuenta → `usuario_id = auth.uid()`);
 * tutor 2 = `tutor_legal_secundario` SIN cuenta (`usuario_id = NULL`; la invitación llega
 * en G-3). Escribe con el cliente del USUARIO: la RLS de `datos_tutor`
 * (`es_admin OR es_tutor_legal_de`) autoriza al tutor del niño. NO toca `dni_documento_path`
 * (lo fija la ruta de subida del DNI), así que reordenar pasos no pisa el documento.
 */
export async function guardarDatosTutor(
  input: GuardarDatosTutorInput
): Promise<ActionResult<{ id: string }>> {
  const parsed = guardarDatosTutorSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'alta.documentos.errors.datos_invalidos')
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('alta.errors.no_autorizado')

  const { nino_id, tipo_vinculo, email, nombre_completo, ...direccion } = parsed.data
  const usuarioId = tipo_vinculo === 'tutor_legal_principal' ? user.id : null

  // ¿Ya existe la fila (nino, tipo_vinculo) viva? → UPDATE; si no → INSERT (centro_id lo
  // pone el trigger `datos_tutor_set_centro_id`).
  const { data: existente } = await supabase
    .from('datos_tutor')
    .select('id')
    .eq('nino_id', nino_id)
    .eq('tipo_vinculo', tipo_vinculo)
    .is('deleted_at', null)
    .maybeSingle()

  const identidad = {
    email: email ?? null,
    nombre_completo: nombre_completo ?? null,
    direccion_calle: direccion.direccion_calle ?? null,
    direccion_numero: direccion.direccion_numero ?? null,
    direccion_cp: direccion.direccion_cp ?? null,
    direccion_ciudad: direccion.direccion_ciudad ?? null,
  }

  if (existente) {
    const { error } = await supabase.from('datos_tutor').update(identidad).eq('id', existente.id)
    if (error) {
      logger.warn('guardarDatosTutor: update', error.message)
      return fail('alta.documentos.errors.guardado')
    }
    return ok({ id: existente.id })
  }

  // centro_id para el INSERT (el trigger `datos_tutor_set_centro_id` lo deriva igual; red
  // de seguridad y exigencia del tipo generado). Lo lee de la ficha del niño (RLS tutor).
  const { data: nino } = await supabase
    .from('ninos')
    .select('centro_id')
    .eq('id', nino_id)
    .maybeSingle()
  if (!nino) return fail('alta.errors.no_autorizado')

  const { data: creada, error } = await supabase
    .from('datos_tutor')
    .insert({
      centro_id: nino.centro_id,
      nino_id,
      tipo_vinculo,
      usuario_id: usuarioId,
      ...identidad,
    })
    .select('id')
    .maybeSingle()
  if (error || !creada) {
    logger.warn('guardarDatosTutor: insert', error?.message)
    if (error?.code === '42501') return fail('alta.errors.no_autorizado')
    return fail('alta.documentos.errors.guardado')
  }
  return ok({ id: creada.id })
}
