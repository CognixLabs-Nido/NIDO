'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { sendInvitation } from '@/features/auth/actions/send-invitation'
import { llamarGoTrue } from '@/features/auth/lib/llamar-gotrue'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, type ActionResult } from '../../centros/types'
import {
  anularAltaCore,
  DIAS_ALTA_SIN_TERMINAR,
  reinvitarAltaCore,
  type ResultadoAnular,
} from '../lib/alta-sin-terminar'

const ninoIdSchema = z.string().uuid()
const reinvitarSchema = z.object({
  ninoId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email('matricula.validation.email_invalido'),
  idioma: z.enum(['es', 'en', 'va']).default('es'),
})

type Puerta =
  | { ok: true; actorId: string; centroId: string; estado: string }
  | { ok: false; error: string }

/**
 * La puerta de las dos acciones: quien llama es de Dirección del centro del niño (con su sesión:
 * `altas_sin_terminar` da 42501 a quien no lo es) y el niño es un alta sin terminar.
 */
async function puerta(ninoId: string): Promise<Puerta> {
  const supabase = await createClient()
  const { data: user, indisponible } = await llamarGoTrue('getUser', () => supabase.auth.getUser())
  if (indisponible)
    return { ok: false, error: 'auth.invitation.errors.servicio_cuentas_no_disponible' }
  if (!user?.user) return { ok: false, error: 'matricula.errors.no_autorizado' }

  const service = createServiceRoleClient()
  const { data: nino } = await service
    .from('ninos')
    .select('centro_id')
    .eq('id', ninoId)
    .maybeSingle()
  if (!nino) return { ok: false, error: 'matricula.errors.alta_ya_no' }

  const { data: altas, error } = await supabase.rpc('altas_sin_terminar', {
    p_centro_id: nino.centro_id,
    p_dias: DIAS_ALTA_SIN_TERMINAR,
  })
  if (error) {
    if (error.code === '42501') return { ok: false, error: 'matricula.errors.no_autorizado' }
    logger.warn('alta sin terminar: la lista', error.message)
    return { ok: false, error: 'matricula.errors.alta_fallo' }
  }
  const alta = (altas ?? []).find((a) => a.nino_id === ninoId)
  if (!alta) return { ok: false, error: 'matricula.errors.alta_ya_no' }
  return { ok: true, actorId: user.user.id, centroId: nino.centro_id, estado: alta.estado }
}

/** Lo que dice la base cuando no deja (por su HINT): siempre un mensaje claro. */
const POR_HINT: Record<string, string> = {
  el_alta_ha_cambiado: 'matricula.errors.alta_ha_cambiado',
  retenido: 'matricula.errors.alta_retenida',
  con_cobros: 'matricula.errors.alta_con_cobros',
  con_actividad: 'matricula.errors.alta_con_actividad',
  alta_iniciada: 'matricula.errors.alta_iniciada',
  email: 'matricula.validation.email_invalido',
}

function claveError(e: unknown): string {
  const { code, hint } = e as { code?: string; hint?: string }
  if (hint && POR_HINT[hint]) return POR_HINT[hint]
  if (code === '42501') return 'matricula.errors.no_autorizado'
  return 'matricula.errors.alta_fallo'
}

/**
 * El botón del alta sin terminar (Dirección). Con la invitación abierta, la cancela; si no, borra
 * el alta (y la familia, si es nueva), sin copia en audit_log (20261209120000).
 */
export async function anularAlta(ninoId: string): Promise<ActionResult<ResultadoAnular>> {
  const parsed = ninoIdSchema.safeParse(ninoId)
  if (!parsed.success) return fail('matricula.validation.invalid')
  const p = await puerta(parsed.data)
  if (!p.ok) return fail(p.error)

  try {
    const r = await anularAltaCore(createServiceRoleClient(), parsed.data, p.actorId)
    if (r.resultado === 'ya_no') return fail('matricula.errors.alta_ya_no')
    revalidatePath('/[locale]/admin/ninos', 'page')
    revalidatePath('/[locale]/admin', 'page')
    return ok(r)
  } catch (e) {
    logger.error('alta sin terminar: anular', e instanceof Error ? e.message : String(e))
    return fail(claveError(e))
  }
}

/**
 * «Enviar una invitación nueva»: corrige el email del tutor y vuelve a invitar. Solo con el alta sin
 * empezar (la invitación sin aceptar).
 */
export async function reinvitarAlta(input: {
  ninoId: string
  email: string
  idioma?: 'es' | 'en' | 'va'
}): Promise<ActionResult<{ email: string }>> {
  const parsed = reinvitarSchema.safeParse(input)
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? 'matricula.validation.invalid')
  const p = await puerta(parsed.data.ninoId)
  if (!p.ok) return fail(p.error)
  if (p.estado === 'iniciada') return fail('matricula.errors.alta_iniciada')

  let tipoVinculo: 'tutor_legal_principal' | 'tutor_legal_secundario'
  try {
    const r = await reinvitarAltaCore(
      createServiceRoleClient(),
      parsed.data.ninoId,
      parsed.data.email,
      p.actorId
    )
    if (!r) return fail('matricula.errors.alta_ya_no')
    tipoVinculo = r.tipoVinculo
  } catch (e) {
    logger.error('alta sin terminar: reinvitar', e instanceof Error ? e.message : String(e))
    return fail(claveError(e))
  }

  const inv = await sendInvitation({
    email: parsed.data.email,
    rolObjetivo: 'tutor_legal',
    centroId: p.centroId,
    ninoId: parsed.data.ninoId,
    tipoVinculo,
    idioma: parsed.data.idioma,
  })
  revalidatePath('/[locale]/admin/ninos', 'page')
  // El email ya está corregido: si el correo no sale, se dice, y se puede volver a enviar.
  if (!inv.success) return fail('matricula.errors.alta_correo_no_salio')
  return ok({ email: parsed.data.email })
}
