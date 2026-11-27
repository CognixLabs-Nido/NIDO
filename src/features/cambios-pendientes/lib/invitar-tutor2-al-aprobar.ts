import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { invitarTutor2 } from '@/features/matriculas/lib/invitacion-tutor2'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/db'

import { payloadDatosTutorSchema } from '../schemas'
import type { CambioRow } from './aplicar'
import { altaValidada } from './gate'

type Service = SupabaseClient<Database>

/**
 * La decisión de invitar al segundo tutor, tomada ANTES de aplicar un cambio de sus datos: `aplica`
 * false si el cambio no es de sus datos. Se guarda en la fila (`invita_tutor2`, B2, 2026-11-27) para que
 * un reintento la lea en vez de recalcularla: tras aplicar, el email de antes ya es el nuevo.
 */
export type DecisionTutor2 = { aplica: false } | { aplica: true; invita: boolean }

/** Qué pasó con la invitación al aprobar: nada que invitar, invitado, o no salió (aviso). */
export type InvitacionAlAprobar = 'no_aplica' | 'invitado' | 'no_salio'

function normalizar(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase()
  return e ? e : null
}

/**
 * Decide, antes de aplicar un cambio de los datos del segundo tutor, si hay que invitarle: su email nuevo
 * (el del cambio) frente al de su ficha hoy. Un cambio de dirección no invita (no se mandan correos por
 * cambiar un piso); un segundo tutor que se añade ahora (sin fila) sí, si trae email. Si la lectura FALLA,
 * lanza: sin saber el email de antes no se puede decidir, y el llamador no aplica.
 */
export async function decidirInvitacionTutor2(
  service: Service,
  fila: CambioRow
): Promise<DecisionTutor2> {
  if (fila.entidad !== 'datos_tutor') return { aplica: false }
  const p = payloadDatosTutorSchema.safeParse(fila.payload)
  if (!p.success || p.data.tipo_vinculo !== 'tutor_legal_secundario') return { aplica: false }

  const { data: nino, error } = await service
    .from('ninos')
    .select('familia_id')
    .eq('id', fila.nino_id)
    .maybeSingle()
  if (error) throw new Error(`ninos: ${error.message}`)
  if (!nino) throw new Error('nino_no_encontrado')
  const { data: t2, error: e2 } = await service
    .from('familia_tutores')
    .select('email')
    .eq('familia_id', nino.familia_id)
    .eq('rol_familia', 'segundo_tutor')
    .is('deleted_at', null)
    .maybeSingle()
  if (e2) throw new Error(`familia_tutores: ${e2.message}`)
  const nuevo = normalizar(p.data.email)
  return { aplica: true, invita: nuevo !== null && nuevo !== normalizar(t2?.email) }
}

/**
 * Tras aplicar el cambio: si se decidió invitar (`decidirInvitacionTutor2`: el email del segundo tutor
 * es nuevo, o el segundo tutor se añade ahora) y el alta está validada, la cola le invita sola, con el
 * mismo núcleo que el botón «Reenviar» (decisión del responsable, 2026-11-04). Hasta ahora la cola escribía la fila y no
 * invitaba a nadie, y esa persona se quedaba fuera sin que nadie se enterara.
 *
 * Nunca lanza: el cambio ya está aplicado, y un fallo aquí NO lo deshace. Vuelve `no_salio` y quien
 * aprueba lo lee como aviso: el dato está aprobado, la invitación no ha salido, y se reenvía a mano desde
 * «Altas en proceso». Va ANTES de marcar la fila 'aprobado' (B2): si el proceso muere entre medias, el
 * reintento vuelve a invitar (inofensivo, medido en `segunda-invitacion-tutor2.rls.test.ts`); al revés,
 * la invitación se perdería.
 */
export async function invitarTutor2SiCambioElEmail(
  service: Service,
  fila: CambioRow,
  invita: boolean,
  actorId: string
): Promise<InvitacionAlAprobar> {
  try {
    if (!invita) return 'no_aplica'
    if (!(await altaValidada(service, fila.nino_id))) return 'no_aplica'

    const r = await invitarTutor2(service, fila.nino_id, actorId, fila.centro_id)
    if (!r) return 'no_aplica'
    if (r.ok) return 'invitado'
    // Ya tiene cuenta o se quedó sin email: no hay a quién invitar.
    return r.motivo === 'correo_no_salio' ? 'no_salio' : 'no_aplica'
  } catch (e) {
    logger.error(
      'aprobarCambio: invitar al segundo tutor',
      e instanceof Error ? e.message : 'desconocido'
    )
    return 'no_salio'
  }
}
