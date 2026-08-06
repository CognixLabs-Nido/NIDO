'use server'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

import { esAdminDelCentro } from '../lib/authz-admisiones'
import { resolverTutorPorEmail } from '../lib/resolver-tutor-email'

import { fail, ok, type ActionResult } from '../../centros/types'

import type { DeteccionTutor } from '../lib/deteccion-tutor'

export interface VistaPreviaTutor {
  deteccion: DeteccionTutor
  familiaEtiqueta: string | null
}

/**
 * U-5 (D7) — VISTA PREVIA de la detección para el diálogo del botón único: al teclear el
 * email, la dirección ve si ese alumno va a nacer como familia nueva o como 2.º hijo de un
 * tutor que ya existe (y de qué familia), ANTES de confirmar.
 *
 * Es SOLO LECTURA: no escribe nada. La resolución que cuenta la vuelve a hacer
 * `crearProspecto` en el servidor al persistir — el cliente no puede fijar el
 * `tutor_usuario_id` mandándolo en el payload.
 *
 * Solo devuelve la CLASE y, como mucho, la etiqueta de la familia del propio centro: no
 * expone el `usuario_id` ni ningún dato de la cuenta a la que pertenece el email.
 */
export async function resolverTutorParaProspecto(
  email: string
): Promise<ActionResult<VistaPreviaTutor>> {
  const supabase = await createClient()
  const centroId = await getCentroActualId()
  if (!centroId) return fail('listaEspera.errors.sin_centro')
  if (!(await esAdminDelCentro(supabase, centroId))) return fail('auth.invitation.errors.forbidden')

  const resuelto = await resolverTutorPorEmail(createServiceRoleClient(), email, centroId)
  if (!resuelto) return fail('auth.invitation.errors.servicio_cuentas_no_disponible')

  return ok({ deteccion: resuelto.deteccion, familiaEtiqueta: resuelto.familiaEtiqueta })
}
