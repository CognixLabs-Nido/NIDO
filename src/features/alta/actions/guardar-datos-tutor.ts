'use server'

import { createClient } from '@/lib/supabase/server'
import { altaValidada, registrarCambioPendiente } from '@/features/cambios-pendientes/lib/gate'
import { logger } from '@/shared/lib/logger'

import {
  guardarDatosTutorSchema,
  rolFamiliaDeVinculo,
  type GuardarDatosTutorInput,
} from '../schemas/alta-documentos'

import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F-2b-3 — upsert del perfil del tutor (identidad + dirección) en `familia_tutores` (perfil
 * COMPARTIDO por familia; supera al `datos_tutor` por-niño). tutor 1 = `titular` (su fila la
 * creó la RPC de alta con `usuario_id` = su cuenta) → SIEMPRE UPDATE, nunca INSERT. tutor 2 =
 * `segundo_tutor` SIN cuenta (`usuario_id = NULL`; la invitación/backfill llegan en accept-
 * invitation) → SELECT→UPDATE|INSERT. Escribe con el cliente del USUARIO: la RLS de tutor de
 * F-2b-3a (`es_tutor_de_familia`) autoriza; el congelado (BEFORE UPDATE) no salta porque solo
 * se tocan identidad/dirección. NO toca `dni_documento_path` (lo fija la ruta del DNI).
 */
export async function guardarDatosTutor(
  input: GuardarDatosTutorInput
): Promise<ActionResult<{ id?: string; pendienteValidacion?: boolean }>> {
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

  // Decisión J: con el alta YA validada, la edición no se aplica directa → cola de validación.
  // El payload conserva `tipo_vinculo` (la cola lo mapea a rol_familia al aplicar, 3d).
  if (await altaValidada(supabase, nino_id)) {
    const r = await registrarCambioPendiente(supabase, {
      ninoId: nino_id,
      usuarioId: user.id,
      entidad: 'datos_tutor',
      payload: { tipo_vinculo, email, nombre_completo, ...direccion },
    })
    if (!r.ok) return fail(r.error)
    return ok({ pendienteValidacion: true })
  }

  // Resolución niño → familia. Con `ninos.familia_id` NOT NULL (F-2b-3) esto no falla salvo
  // niño inexistente/sin acceso → guard defensivo, no rama de negocio.
  const { data: nino } = await supabase
    .from('ninos')
    .select('familia_id')
    .eq('id', nino_id)
    .maybeSingle()
  if (!nino?.familia_id) return fail('alta.errors.no_autorizado')
  const familiaId = nino.familia_id
  const rolFamilia = rolFamiliaDeVinculo(tipo_vinculo)

  const identidad = {
    email: email ?? null,
    nombre_completo: nombre_completo ?? null,
    direccion_calle: direccion.direccion_calle ?? null,
    direccion_numero: direccion.direccion_numero ?? null,
    direccion_cp: direccion.direccion_cp ?? null,
    direccion_ciudad: direccion.direccion_ciudad ?? null,
  }

  // Upsert por (familia_id, rol_familia) SIN ON CONFLICT: SELECT vivo → rama por rol.
  const { data: existente } = await supabase
    .from('familia_tutores')
    .select('id')
    .eq('familia_id', familiaId)
    .eq('rol_familia', rolFamilia)
    .is('deleted_at', null)
    .maybeSingle()

  if (existente) {
    const { error } = await supabase
      .from('familia_tutores')
      .update(identidad)
      .eq('id', existente.id)
    if (error) {
      logger.warn('guardarDatosTutor: update', error.message)
      if (error.code === '42501') return fail('alta.errors.no_autorizado')
      return fail('alta.documentos.errors.guardado')
    }
    return ok({ id: existente.id })
  }

  // Titular SIEMPRE UPDATE: su fila la crea la RPC de alta. Sin fila viva = estado anómalo
  // (nunca INSERT: `insert_tutor` exige rol_familia='segundo_tutor') → pedir recarga.
  if (rolFamilia === 'titular') {
    logger.warn('guardarDatosTutor: titular sin fila', familiaId)
    return fail('alta.documentos.errors.tutor_duplicado')
  }

  // segundo_tutor: primera vez → INSERT (usuario_id NULL; el backfill de cuenta es service_role).
  const { data: creada, error } = await supabase
    .from('familia_tutores')
    .insert({ familia_id: familiaId, rol_familia: 'segundo_tutor', usuario_id: null, ...identidad })
    .select('id')
    .maybeSingle()
  if (error || !creada) {
    logger.warn('guardarDatosTutor: insert', error?.message)
    // Carrera con el índice único parcial (familia_id, rol_familia): otra pestaña ya insertó.
    if (error?.code === '23505') return fail('alta.documentos.errors.tutor_duplicado')
    if (error?.code === '42501') return fail('alta.errors.no_autorizado')
    return fail('alta.documentos.errors.guardado')
  }
  return ok({ id: creada.id })
}
