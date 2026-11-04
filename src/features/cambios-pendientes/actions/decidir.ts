'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, type ActionResult } from '../../centros/types'
import {
  aplicarCambioPendiente,
  descartarCambioPendiente,
  RutaDocumentoInvalidaError,
} from '../lib/aplicar'
import {
  invitarTutor2SiCambioElEmail,
  leerEmailTutor2Antes,
  type AntesTutor2,
  type InvitacionAlAprobar,
} from '../lib/invitar-tutor2-al-aprobar'

const idSchema = z.string().uuid()

/**
 * F11-G-3 (decisión J) — la dirección APRUEBA un cambio pendiente: marca la fila
 * `'aprobado'` (la RLS `cambios_pendientes_update` exige `es_admin` → es el gate de
 * autorización; el `.eq('estado','pendiente')` da idempotencia "USING falso → 0 filas") y
 * luego APLICA el cambio con service role. Si el apply falla, revierte el estado a
 * `'pendiente'` (best-effort) para no dejar la fila marcada como aprobada sin aplicar.
 *
 * Si el cambio da al segundo tutor un email nuevo (lo corrige, o se añade ahora) con el alta
 * validada, la cola le invita sola (2026-11-04): el email de antes se lee ANTES de aplicar, y un
 * fallo al invitar no deshace la aprobación, vuelve como aviso (`tutor2: 'no_salio'`).
 */
export async function aprobarCambio(
  cambioId: string
): Promise<ActionResult<{ id: string; tutor2: InvitacionAlAprobar }>> {
  const parsed = idSchema.safeParse(cambioId)
  if (!parsed.success) return fail('admin.pendientes.errors.invalido')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('alta.errors.no_autorizado')

  const { data: fila, error } = await supabase
    .from('cambios_pendientes')
    .update({ estado: 'aprobado', revisado_por: user.id, decided_at: new Date().toISOString() })
    .eq('id', parsed.data)
    .eq('estado', 'pendiente')
    .select('id, entidad, centro_id, nino_id, payload')
    .maybeSingle()
  if (error) {
    if (error.code === '42501') return fail('alta.errors.no_autorizado')
    logger.warn('aprobarCambio: update', error.message)
    return fail('admin.pendientes.errors.decidir')
  }
  if (!fila) return fail('admin.pendientes.errors.no_pendiente')

  // PR-D (D2): la BD se escribe con la sesión de la directora (audit con SU uid); el service
  // role solo borra en Storage el documento anterior.
  const service = createServiceRoleClient()
  // El apply falló tras marcar 'aprobado' → revertir a 'pendiente' para reintentar
  // (best-effort: el UPDATE resuelve con {error}, no lanza). Misma RLS que el UPDATE de
  // arriba (`cambios_pendientes_update`, es_admin).
  const revertir = () =>
    supabase
      .from('cambios_pendientes')
      .update({ estado: 'pendiente', revisado_por: null, decided_at: null })
      .eq('id', fila.id)

  // El email del segundo tutor ANTES de aplicar: sin él no se distingue un cambio de email de
  // uno de dirección. Si no se puede leer, no se aplica nada.
  let antes: AntesTutor2
  try {
    antes = await leerEmailTutor2Antes(service, fila)
  } catch (e) {
    await revertir()
    logger.warn(
      'aprobarCambio: leer el segundo tutor',
      e instanceof Error ? e.message : 'desconocido'
    )
    return fail('admin.pendientes.errors.aplicar')
  }

  try {
    await aplicarCambioPendiente(supabase, service, fila)
  } catch (e) {
    await revertir()
    logger.warn('aprobarCambio: aplicar', e instanceof Error ? e.message : 'desconocido')
    // R1b: la ruta del documento no es del niño de la fila → no se escribe ni se reintentará.
    if (e instanceof RutaDocumentoInvalidaError)
      return fail('admin.pendientes.errors.ruta_invalida')
    return fail('admin.pendientes.errors.aplicar')
  }

  // Aprobado y aplicado: lo que pase con la invitación ya no lo deshace.
  const tutor2 = antes.aplica
    ? await invitarTutor2SiCambioElEmail(service, fila, antes.email, user.id)
    : 'no_aplica'

  revalidatePath('/[locale]/admin/pendientes', 'page')
  if (tutor2 !== 'no_aplica') revalidatePath('/[locale]/admin/altas', 'page')
  return ok({ id: fila.id, tutor2 })
}

/**
 * F11-G-3 — la dirección RECHAZA un cambio pendiente: marca la fila `'rechazado'` (el dato
 * queda como estaba) y descarta los objetos staged de documentos que hubieran quedado
 * subidos a la espera de validación. Idempotente (`.eq('estado','pendiente')`).
 */
export async function rechazarCambio(cambioId: string): Promise<ActionResult<{ id: string }>> {
  const parsed = idSchema.safeParse(cambioId)
  if (!parsed.success) return fail('admin.pendientes.errors.invalido')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail('alta.errors.no_autorizado')

  const { data: fila, error } = await supabase
    .from('cambios_pendientes')
    .update({ estado: 'rechazado', revisado_por: user.id, decided_at: new Date().toISOString() })
    .eq('id', parsed.data)
    .eq('estado', 'pendiente')
    .select('id, entidad, centro_id, nino_id, payload')
    .maybeSingle()
  if (error) {
    if (error.code === '42501') return fail('alta.errors.no_autorizado')
    logger.warn('rechazarCambio: update', error.message)
    return fail('admin.pendientes.errors.decidir')
  }
  if (!fila) return fail('admin.pendientes.errors.no_pendiente')

  const service = createServiceRoleClient()
  await descartarCambioPendiente(service, fila).catch(() => undefined)

  revalidatePath('/[locale]/admin/pendientes', 'page')
  return ok({ id: fila.id })
}
