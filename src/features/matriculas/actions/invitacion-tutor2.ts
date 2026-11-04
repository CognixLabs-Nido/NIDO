'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { sendInvitation } from '@/features/auth/actions/send-invitation'
import { usuarioAdminEn } from '@/features/centros/contexto/roles-del-usuario'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, type ActionResult } from '../../centros/types'
import { cancelarInvitacionTutor2Core, destinoReenvioTutor2 } from '../lib/invitacion-tutor2'
import { idiomaDelTitular } from '../lib/invitar-tutor-2'

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
 * provisionales que crearon (20261231120000). Su ficha en la familia se queda: se puede reenviar.
 */
export async function cancelarInvitacionTutor2(
  ninoId: string
): Promise<ActionResult<{ invitaciones: number }>> {
  const parsed = ninoIdSchema.safeParse(ninoId)
  if (!parsed.success) return fail('matricula.validation.invalid')
  const p = await puerta(parsed.data)
  if (!p.ok) return fail(p.error)
  try {
    const r = await cancelarInvitacionTutor2Core(
      createServiceRoleClient(),
      parsed.data,
      p.actorId,
      null
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
 * «Reenviar la invitación» al email del segundo tutor en su ficha. Hoy, si la familia corrige ese
 * email o añade un segundo tutor después de validar, la cola escribe la fila y no se invita a nadie
 * (medido el 2026-11-04): este botón es lo que lo cierra. Primero se cancelan las invitaciones a
 * otros emails y sus cuentas provisionales; la del email actual se queda, y `sendInvitation` la
 * reutiliza (le alarga el plazo y GoTrue reenvía a la misma cuenta provisional): no se duplica nada.
 */
export async function reenviarInvitacionTutor2(
  ninoId: string
): Promise<ActionResult<{ email: string }>> {
  const parsed = ninoIdSchema.safeParse(ninoId)
  if (!parsed.success) return fail('matricula.validation.invalid')
  const p = await puerta(parsed.data)
  if (!p.ok) return fail(p.error)

  const service = createServiceRoleClient()
  let destino: Awaited<ReturnType<typeof destinoReenvioTutor2>>
  try {
    destino = await destinoReenvioTutor2(service, parsed.data)
  } catch (e) {
    logger.error('segundo tutor: reenviar', e instanceof Error ? e.message : String(e))
    return fail('matricula.errors.alta_fallo')
  }
  if (!destino.ok)
    return fail(
      destino.motivo === 'ya_entro'
        ? 'matricula.errors.tutor2_ya_entro'
        : 'matricula.errors.tutor2_sin_email'
    )

  try {
    const r = await cancelarInvitacionTutor2Core(service, parsed.data, p.actorId, destino.email)
    if (!r) return fail('matricula.errors.tutor2_ya_no')
  } catch (e) {
    logger.error(
      'segundo tutor: limpiar antes de reenviar',
      e instanceof Error ? e.message : String(e)
    )
    return fail(claveError(e))
  }

  const inv = await sendInvitation({
    email: destino.email,
    rolObjetivo: 'tutor_legal',
    centroId: p.centroId,
    ninoId: parsed.data,
    tipoVinculo: 'tutor_legal_secundario',
    idioma: await idiomaDelTitular(service, destino.tutores),
  })
  revalidar()
  if (!inv.success) return fail('matricula.errors.tutor2_correo_no_salio')
  return ok({ email: destino.email })
}
