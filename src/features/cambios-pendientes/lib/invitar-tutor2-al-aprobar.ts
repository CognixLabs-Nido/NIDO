import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { invitarTutor2 } from '@/features/matriculas/lib/invitacion-tutor2'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { payloadDatosTutorSchema } from '../schemas'
import type { CambioRow } from './aplicar'
import { altaValidada } from './gate'

type Service = SupabaseClient<Database>

/** El email del segundo tutor ANTES de aplicar el cambio, si el cambio es de sus datos. */
export type AntesTutor2 = { aplica: false } | { aplica: true; email: string | null }

/** Qué pasó con la invitación al aprobar: nada que invitar, invitado, o no salió (aviso). */
export type InvitacionAlAprobar = 'no_aplica' | 'invitado' | 'no_salio'

function normalizar(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase()
  return e ? e : null
}

/**
 * Lee el email del segundo tutor de la familia del niño antes de aplicar un cambio de sus datos.
 * Hace falta para distinguir un cambio de email (se invita) de uno de dirección (no: no se mandan
 * correos por cambiar un piso). Sin fila (el segundo tutor se añade ahora), `email` NULL: es
 * legítimo. Si la lectura FALLA, lanza: sin saber el email de antes no se puede decidir, y el
 * llamador no aplica.
 */
export async function leerEmailTutor2Antes(
  service: Service,
  fila: CambioRow
): Promise<AntesTutor2> {
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
  return { aplica: true, email: normalizar(t2?.email) }
}

/**
 * Tras aplicar el cambio: si el email del segundo tutor es nuevo (cambió, o el segundo tutor se
 * añade ahora) y el alta está validada, la cola le invita sola, con el mismo núcleo que el botón
 * «Reenviar» (decisión del responsable, 2026-11-04). Hasta ahora la cola escribía la fila y no
 * invitaba a nadie, y esa persona se quedaba fuera sin que nadie se enterara.
 *
 * Nunca lanza: el cambio ya está aprobado y aplicado, y un fallo aquí NO lo deshace. Vuelve
 * `no_salio` y quien aprueba lo lee como aviso: el dato está aprobado, la invitación no ha salido,
 * y se reenvía a mano desde «Altas en proceso».
 */
export async function invitarTutor2SiCambioElEmail(
  service: Service,
  fila: CambioRow,
  emailAntes: string | null,
  actorId: string
): Promise<InvitacionAlAprobar> {
  try {
    const p = payloadDatosTutorSchema.parse(fila.payload)
    const nuevo = normalizar(p.email)
    if (!nuevo || nuevo === emailAntes) return 'no_aplica'
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
