'use server'

import { createClient } from '@/lib/supabase/server'
import { altaValidada, registrarCambioPendiente } from '@/features/cambios-pendientes/lib/gate'
import { logger } from '@/shared/lib/logger'

import { esAdminDeCentroDeNino, esTutorLegalDe } from '../lib/authz-tutor'
import {
  actualizarNinoFamiliaSchema,
  type ActualizarNinoFamiliaInput,
  type EstadoCivil,
} from '../schemas/alta-documentos'

import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * F11-G — el TUTOR LEGAL escribe la dirección del menor + el estado civil de la familia
 * (columnas nuevas de `ninos`, G-0). La tabla `ninos` es admin-only por RLS, así que la
 * escritura va por la RPC `actualizar_familia_nino` con el cliente de SESIÓN (PR-D, D2): la
 * RPC re-autoriza (admin del centro del niño o tutor legal), solo admite estas 5 columnas y
 * `auth.uid()` es el del JWT → `audit_log` registra al humano real, no NULL. La autorización
 * en app de abajo se queda como primera barrera.
 *
 * Solo escribe los campos PRESENTES en el input (los `undefined` no se tocan); pasar
 * `null` explícito sí limpia el campo. `estado_civil_familia` es 1 valor por familia: la
 * UI propaga entre hermanos (decisión F), pero esta action escribe solo el niño dado.
 */
export async function actualizarNinoFamilia(
  input: ActualizarNinoFamiliaInput
): Promise<ActionResult<{ id: string; pendienteValidacion?: boolean }>> {
  const parsed = actualizarNinoFamiliaSchema.safeParse(input)
  if (!parsed.success) return fail('alta.documentos.errors.datos_invalidos')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('alta.errors.no_autorizado')

  // Modo Dirección (B2): la Directora del centro del niño también carga estos datos (papel).
  // Se AMPLÍA el gate a admin del centro; el camino tutor queda intacto (OR, no sustitución).
  const autorizado =
    (await esTutorLegalDe(supabase, parsed.data.nino_id, user.id)) ||
    (await esAdminDeCentroDeNino(supabase, parsed.data.nino_id, user.id))
  if (!autorizado) return fail('alta.errors.no_autorizado')

  // Construye el patch solo con las claves presentes (preserva lo no enviado).
  const { nino_id, ...resto } = parsed.data
  const patch: {
    direccion_calle?: string | null
    direccion_numero?: string | null
    direccion_cp?: string | null
    direccion_ciudad?: string | null
    estado_civil_familia?: EstadoCivil | null
  } = {}
  if (resto.direccion_calle !== undefined) patch.direccion_calle = resto.direccion_calle
  if (resto.direccion_numero !== undefined) patch.direccion_numero = resto.direccion_numero
  if (resto.direccion_cp !== undefined) patch.direccion_cp = resto.direccion_cp
  if (resto.direccion_ciudad !== undefined) patch.direccion_ciudad = resto.direccion_ciudad
  if (resto.estado_civil_familia !== undefined)
    patch.estado_civil_familia = resto.estado_civil_familia
  if (Object.keys(patch).length === 0) return ok({ id: nino_id })

  // Decisión J: con el alta YA validada, la edición no se aplica directa → cola de validación.
  if (await altaValidada(supabase, nino_id)) {
    const r = await registrarCambioPendiente(supabase, {
      ninoId: nino_id,
      usuarioId: user.id,
      entidad: 'ninos_familia',
      payload: patch,
    })
    if (!r.ok) return fail(r.error)
    return ok({ id: nino_id, pendienteValidacion: true })
  }

  const { error } = await supabase.rpc('actualizar_familia_nino', {
    p_nino_id: nino_id,
    p_patch: patch,
  })
  if (error) {
    if (error.code === '42501') return fail('alta.errors.no_autorizado')
    logger.warn('actualizarNinoFamilia: rpc', error.message)
    return fail('alta.documentos.errors.guardado')
  }
  return ok({ id: nino_id })
}
