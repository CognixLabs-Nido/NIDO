'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { altaValidada, registrarCambioPendiente } from '@/features/cambios-pendientes/lib/gate'
import { esAdminDeCentroDeNino, esTutorLegalDe } from '@/features/alta/lib/authz-tutor'
import { logger } from '@/shared/lib/logger'
import type { Json } from '@/types/db'

import { respuestasQueCambian } from '../lib/peticion'
import { leerPeticionServicios } from '../queries/leer-peticion-servicios'
import { guardarPeticionServiciosSchema, type GuardarPeticionServiciosInput } from '../schemas'

import { fail, ok, type ActionResult } from '../../centros/types'
import { falloDeLectura } from '@/shared/lib/frontera-lectura'

/**
 * Fase 8b — guarda la petición de servicios del alta. Nunca escribe en la facturación:
 *
 *  - **Antes de validar el alta**, la familia (o la Dirección, en papel o al corregirla antes de
 *    validar) la guarda con `guardar_peticion_servicios`.
 *  - **Con el alta validada**, un cambio cambia lo que se cobra: el tutor lo deja en la cola
 *    (`cambios_pendientes`, entidad `peticion_servicios`, solo lo que cambia) y la Dirección lo
 *    aplica al aprobar (`aplicar_peticion_servicios`). Si quien guarda es la Dirección, se aplica
 *    ya: es lo que haría al aprobar.
 */
export async function guardarPeticionServicios(
  input: GuardarPeticionServiciosInput
): Promise<ActionResult<{ pendienteValidacion: boolean }>> {
  try {
    const parsed = guardarPeticionServiciosSchema.safeParse(input)
    if (!parsed.success) return fail('peticion_servicios.errors.invalida')
    const { nino_id, respuestas } = parsed.data

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return fail('alta.errors.no_autorizado')

    const esTutor = await esTutorLegalDe(supabase, nino_id, user.id)
    const esDireccion = !esTutor && (await esAdminDeCentroDeNino(supabase, nino_id, user.id))
    if (!esTutor && !esDireccion) return fail('alta.errors.no_autorizado')

    if (await altaValidada(supabase, nino_id)) {
      const leida = await leerPeticionServicios(supabase, nino_id)
      if (!leida.ok) return fail('peticion_servicios.errors.guardar')
      const cambios = respuestasQueCambian(leida.respuestas, respuestas)
      if (cambios.length === 0) return ok({ pendienteValidacion: false })
      if (esDireccion) {
        const { error } = await supabase.rpc('aplicar_peticion_servicios', {
          p_nino_id: nino_id,
          p_respuestas: cambios as unknown as Json,
        })
        if (error) return fail(errorDeLaBase(error))
        revalidatePath('/[locale]/alta/[ninoId]', 'page')
        return ok({ pendienteValidacion: false })
      }
      const r = await registrarCambioPendiente(supabase, {
        ninoId: nino_id,
        usuarioId: user.id,
        entidad: 'peticion_servicios',
        payload: { respuestas: cambios },
      })
      if (!r.ok) return fail(r.error)
      return ok({ pendienteValidacion: true })
    }

    const { error } = await supabase.rpc('guardar_peticion_servicios', {
      p_nino_id: nino_id,
      p_respuestas: respuestas as unknown as Json,
    })
    if (error) return fail(errorDeLaBase(error))
    revalidatePath('/[locale]/alta/[ninoId]', 'page')
    revalidatePath('/[locale]/admin/ninos/[id]', 'page')
    return ok({ pendienteValidacion: false })
  } catch (e) {
    return falloDeLectura(e)
  }
}

/** El HINT de la base, dicho; lo demás, «no se pudo guardar». */
function errorDeLaBase(error: { code?: string; hint?: string | null; message: string }): string {
  if (error.code === '42501') return 'alta.errors.no_autorizado'
  if (error.hint === 'opcion_no_ofrecida') return 'peticion_servicios.errors.opcion_no_ofrecida'
  if (error.hint === 'alta_validada') return 'peticion_servicios.errors.alta_validada'
  if (error.hint === 'mensual_anterior_en_borrador')
    return 'peticion_servicios.errors.mensual_anterior_en_borrador'
  logger.warn('guardarPeticionServicios', error.message)
  return 'peticion_servicios.errors.guardar'
}
