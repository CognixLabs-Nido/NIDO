import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { leerTutoresDeNino } from '@/features/alta/lib/tutores-familia'
import { sendInvitation } from '@/features/auth/actions/send-invitation'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { borrarCuentasDeAuth } from './alta-sin-terminar'
import { idiomaDelTitular } from './invitar-tutor-2'

type Service = SupabaseClient<Database>

/**
 * La parte del servidor de «Cancelar» y «Reenviar» del segundo tutor (20261231120000): la base
 * borra sin copia sus invitaciones sin aceptar (salvo la del email que se queda, en el reenvío) y
 * las cuentas provisionales que crearon y nunca entraron; aquí se borran esas cuentas de Auth. Si
 * la Admin API falla, `borrarCuentasDeAuth` les deja el email de la purga para que el cron las
 * vuelva a encontrar. NULL: el niño ya no existe.
 */
export async function cancelarInvitacionTutor2Core(
  service: Service,
  ninoId: string,
  actorId: string,
  emailSeQueda: string | null
): Promise<{ invitaciones: number; cuentas: number } | null> {
  const { data, error } = await service.rpc('cancelar_invitacion_tutor2', {
    p_nino_id: ninoId,
    p_actor: actorId,
    ...(emailSeQueda ? { p_email_se_queda: emailSeQueda } : {}),
  })
  if (error) throw Object.assign(new Error(error.message), { code: error.code, hint: error.hint })
  if (!data) return null
  const r = data as { invitaciones: number; stubs: string[] }
  const stubs = r.stubs ?? []
  await borrarCuentasDeAuth(service, stubs)
  return { invitaciones: r.invitaciones ?? 0, cuentas: stubs.length }
}

/**
 * A quién va el reenvío: el email del segundo tutor en su ficha, si no tiene cuenta ni vínculo con
 * el niño. El email lo corrige el tutor 1 por la cola y Dirección lo aprueba (decisión del
 * responsable, 2026-11-04): aquí solo se lee.
 */
export async function destinoReenvioTutor2(
  service: Service,
  ninoId: string
): Promise<
  | {
      ok: true
      email: string
      tutores: Awaited<ReturnType<typeof leerTutoresDeNino>>['tutores']
    }
  | { ok: false; motivo: 'sin_tutor2' | 'ya_entro' }
> {
  const { tutores } = await leerTutoresDeNino(service, ninoId)
  const tutor2 = tutores.find((t) => t.tipo_vinculo === 'tutor_legal_secundario')
  const email = tutor2?.email?.trim().toLowerCase()
  if (!tutor2 || !email) return { ok: false, motivo: 'sin_tutor2' }
  if (tutor2.usuario_id) return { ok: false, motivo: 'ya_entro' }
  const { data: vinculo, error } = await service
    .from('vinculos_familiares')
    .select('id')
    .eq('nino_id', ninoId)
    .eq('tipo_vinculo', 'tutor_legal_secundario')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`vinculos_familiares: ${error.message}`)
  if (vinculo) return { ok: false, motivo: 'ya_entro' }
  return { ok: true, email, tutores }
}

export type ResultadoInvitarTutor2 =
  | { ok: true; email: string }
  | { ok: false; motivo: 'sin_tutor2' | 'ya_entro' | 'correo_no_salio' }

/**
 * Invita al segundo tutor al email de su ficha, sin dejar basura. Lo usan el botón «Reenviar» de
 * «Altas en proceso» y la cola de cambios al aprobar un email nuevo o un segundo tutor nuevo
 * (2026-11-04).
 *
 * La invitación del segundo tutor es de la FAMILIA, aunque cuelgue de un niño: al aceptarla queda
 * vinculado a todos los hijos (`invitarTutor2AlValidar`). Por eso se limpian las invitaciones a
 * otros emails, y sus cuentas provisionales, en todos los hermanos, no solo en el niño por el que
 * se entra; y si ya hay una invitación al email actual en un hermano, se reenvía esa en vez de
 * abrir otra. NULL: el niño ya no existe. Lanza si la base falla o no es Dirección (42501).
 */
export async function invitarTutor2(
  service: Service,
  ninoId: string,
  actorId: string,
  centroId: string
): Promise<ResultadoInvitarTutor2 | null> {
  const destino = await destinoReenvioTutor2(service, ninoId)
  if (!destino.ok) return destino

  const hermanos = await ninosDeLaFamilia(service, ninoId)
  if (!hermanos) return null
  for (const h of hermanos) {
    const r = await cancelarInvitacionTutor2Core(service, h, actorId, destino.email)
    if (!r && h === ninoId) return null
  }

  const { data: vivas, error } = await service
    .from('invitaciones')
    .select('nino_id, email, created_at')
    .in('nino_id', hermanos)
    .eq('tipo_vinculo', 'tutor_legal_secundario')
    .is('accepted_at', null)
    .is('rejected_at', null)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`invitaciones: ${error.message}`)
  const yaAbierta = (vivas ?? []).find((i) => i.email.trim().toLowerCase() === destino.email)

  const inv = await sendInvitation({
    email: destino.email,
    rolObjetivo: 'tutor_legal',
    centroId,
    ninoId: yaAbierta?.nino_id ?? ninoId,
    tipoVinculo: 'tutor_legal_secundario',
    idioma: await idiomaDelTitular(service, destino.tutores),
  })
  if (!inv.success) {
    logger.warn('segundo tutor: la invitación no salió', inv.error)
    return { ok: false, motivo: 'correo_no_salio' }
  }
  return { ok: true, email: destino.email }
}

/** Los niños vivos de la familia del niño, él incluido. NULL si el niño ya no existe. */
async function ninosDeLaFamilia(service: Service, ninoId: string): Promise<string[] | null> {
  const { data: nino, error } = await service
    .from('ninos')
    .select('familia_id')
    .eq('id', ninoId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(`ninos: ${error.message}`)
  if (!nino) return null
  const { data: todos, error: e2 } = await service
    .from('ninos')
    .select('id')
    .eq('familia_id', nino.familia_id)
    .is('deleted_at', null)
  if (e2) throw new Error(`ninos de la familia: ${e2.message}`)
  return (todos ?? []).map((n) => n.id)
}

/**
 * «Cancelar» del segundo tutor en toda la familia: sus invitaciones sin aceptar y sus cuentas
 * provisionales, en cada hermano (la invitación es de la familia, ver `invitarTutor2`). NULL: el
 * niño ya no existe.
 */
export async function cancelarInvitacionTutor2Familia(
  service: Service,
  ninoId: string,
  actorId: string
): Promise<{ invitaciones: number } | null> {
  const hermanos = await ninosDeLaFamilia(service, ninoId)
  if (!hermanos) return null
  let invitaciones = 0
  for (const h of hermanos) {
    const r = await cancelarInvitacionTutor2Core(service, h, actorId, null)
    if (!r && h === ninoId) return null
    invitaciones += r?.invitaciones ?? 0
  }
  return { invitaciones }
}
