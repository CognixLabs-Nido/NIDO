'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { usuarioAdminEn } from '@/features/centros/contexto/roles-del-usuario'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, type ActionResult } from '../../centros/types'
import { cancelarInvitacionTutor2Familia, invitarTutor2 } from '../lib/invitacion-tutor2'

const ninoIdSchema = z.string().uuid()

type Puerta = { ok: true; actorId: string; centroId: string } | { ok: false; error: string }

/**
 * Quien llama es de Dirección del centro del niño (con su sesión). La base lo vuelve a mirar
 * (`privado.es_direccion`) en `cancelar_invitacion_tutor2`, y `sendInvitation` también.
 */
async function puerta(ninoId: string): Promise<Puerta> {
  const service = createServiceRoleClient()
  const { data: nino } = await service
    .from('ninos')
    .select('centro_id')
    .eq('id', ninoId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!nino) return { ok: false, error: 'matricula.errors.tutor2_ya_no' }
  const actorId = await usuarioAdminEn(await createClient(), nino.centro_id)
  if (!actorId) return { ok: false, error: 'matricula.errors.no_autorizado' }
  return { ok: true, actorId, centroId: nino.centro_id }
}

function claveError(e: unknown): string {
  const { code } = e as { code?: string }
  if (code === '42501') return 'matricula.errors.no_autorizado'
  return 'matricula.errors.alta_fallo'
}

function revalidar() {
  revalidatePath('/[locale]/admin/altas', 'page')
  revalidatePath('/[locale]/admin/ninos', 'page')
}

/**
 * «Cancelar la invitación» del segundo tutor: se van sus invitaciones sin aceptar y las cuentas
 * provisionales que crearon (20261231120000), en toda la familia. Su ficha en la familia se queda: se puede reenviar.
 */
export async function cancelarInvitacionTutor2(
  ninoId: string
): Promise<ActionResult<{ invitaciones: number }>> {
  const parsed = ninoIdSchema.safeParse(ninoId)
  if (!parsed.success) return fail('matricula.validation.invalid')
  const p = await puerta(parsed.data)
  if (!p.ok) return fail(p.error)
  try {
    const r = await cancelarInvitacionTutor2Familia(
      createServiceRoleClient(),
      parsed.data,
      p.actorId
    )
    if (!r) return fail('matricula.errors.tutor2_ya_no')
    revalidar()
    return ok({ invitaciones: r.invitaciones })
  } catch (e) {
    logger.error('segundo tutor: cancelar', e instanceof Error ? e.message : String(e))
    return fail(claveError(e))
  }
}

/**
 * «Reenviar la invitación» al email del segundo tutor en su ficha. Medido el 2026-11-04: si la
 * familia corregía ese email o añadía un segundo tutor después de validar, la cola escribía la fila
 * y no se invitaba a nadie. Desde el 2026-11-04 la cola invita sola al aprobar (`aprobarCambio`), con
 * este mismo núcleo; el botón queda para recuperar (un correo que no salió, una invitación caducada).
 * Primero se cancelan, en toda la familia, las invitaciones a otros emails y sus cuentas
 * provisionales; la del email actual se queda y `sendInvitation` la reutiliza (le alarga el plazo y
 * GoTrue reenvía a la misma cuenta provisional): no se duplica nada (`invitarTutor2`).
 */
export async function reenviarInvitacionTutor2(
  ninoId: string
): Promise<ActionResult<{ email: string }>> {
  const parsed = ninoIdSchema.safeParse(ninoId)
  if (!parsed.success) return fail('matricula.validation.invalid')
  const p = await puerta(parsed.data)
  if (!p.ok) return fail(p.error)

  let r: Awaited<ReturnType<typeof invitarTutor2>>
  try {
    r = await invitarTutor2(createServiceRoleClient(), parsed.data, p.actorId, p.centroId)
  } catch (e) {
    logger.error('segundo tutor: reenviar', e instanceof Error ? e.message : String(e))
    return fail(claveError(e))
  }
  revalidar()
  if (!r) return fail('matricula.errors.tutor2_ya_no')
  if (!r.ok) {
    if (r.motivo === 'ya_entro') return fail('matricula.errors.tutor2_ya_entro')
    if (r.motivo === 'sin_tutor2') return fail('matricula.errors.tutor2_sin_email')
    return fail('matricula.errors.tutor2_correo_no_salio')
  }
  return ok({ email: r.email })
}
