'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, type ActionResult } from '../../centros/types'
import { aplicarCambioPendiente, descartarCambioPendiente } from '../lib/aplicar'

const idSchema = z.string().uuid()

/**
 * F11-G-3 (decisión J) — la dirección APRUEBA un cambio pendiente: marca la fila
 * `'aprobado'` (la RLS `cambios_pendientes_update` exige `es_admin` → es el gate de
 * autorización; el `.eq('estado','pendiente')` da idempotencia "USING falso → 0 filas") y
 * luego APLICA el cambio con service role. Si el apply falla, revierte el estado a
 * `'pendiente'` (best-effort) para no dejar la fila marcada como aprobada sin aplicar.
 */
export async function aprobarCambio(cambioId: string): Promise<ActionResult<{ id: string }>> {
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
    .select('id, entidad, nino_id, payload')
    .maybeSingle()
  if (error) {
    if (error.code === '42501') return fail('alta.errors.no_autorizado')
    logger.warn('aprobarCambio: update', error.message)
    return fail('admin.pendientes.errors.decidir')
  }
  if (!fila) return fail('admin.pendientes.errors.no_pendiente')

  const service = createServiceRoleClient()
  try {
    await aplicarCambioPendiente(service, fila)
  } catch (e) {
    // El apply falló tras marcar 'aprobado' → revertir a 'pendiente' para reintentar
    // (best-effort: el UPDATE resuelve con {error}, no lanza).
    await service
      .from('cambios_pendientes')
      .update({ estado: 'pendiente', revisado_por: null, decided_at: null })
      .eq('id', fila.id)
    logger.warn('aprobarCambio: aplicar', e instanceof Error ? e.message : 'desconocido')
    return fail('admin.pendientes.errors.aplicar')
  }

  revalidatePath('/[locale]/admin/pendientes', 'page')
  return ok({ id: fila.id })
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
    .select('id, entidad, nino_id, payload')
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
