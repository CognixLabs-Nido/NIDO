import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { leerTutoresDeNino } from '@/features/alta/lib/tutores-familia'

import type { Database } from '@/types/database'

import { borrarCuentasDeAuth } from './alta-sin-terminar'

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
