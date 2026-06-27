import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/types/database'

import type { EntidadCambio } from '../schemas'

type Client = SupabaseClient<Database>

/**
 * F11-G-3 — ¿el alta del niño YA está validada por la dirección? (matrícula vigente
 * `'activa'`). Es la frontera de la decisión J: con el alta validada, las ediciones de datos
 * sensibles NO se aplican directas, sino que van a la cola `cambios_pendientes`.
 */
export async function altaValidada(supabase: Client, ninoId: string): Promise<boolean> {
  const { data } = await supabase
    .from('matriculas')
    .select('estado')
    .eq('nino_id', ninoId)
    .is('fecha_baja', null)
    .is('deleted_at', null)
    .maybeSingle()
  return data?.estado === 'activa'
}

/**
 * Registra una edición del tutor en la cola de validación (`cambios_pendientes`, estado
 * `'pendiente'`). Se escribe con el cliente del USUARIO: la RLS autoriza al tutor legal del
 * niño y exige `solicitado_por = auth.uid()` (anti-suplantación). `centro_id` lo deriva el
 * trigger; `registro_id` ancla al niño afectado (el detalle del destino va en `payload`).
 */
export async function registrarCambioPendiente(
  supabase: Client,
  input: {
    ninoId: string
    usuarioId: string
    entidad: EntidadCambio
    payload: Record<string, unknown>
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  // `centro_id` lo deriva el trigger `cambios_pendientes_set_centro_id`; se pasa también
  // porque el tipo generado lo exige NOT NULL. El tutor lee la ficha de su niño (RLS).
  const { data: nino } = await supabase
    .from('ninos')
    .select('centro_id')
    .eq('id', input.ninoId)
    .maybeSingle()
  if (!nino) return { ok: false, error: 'alta.errors.no_autorizado' }

  const { error } = await supabase.from('cambios_pendientes').insert({
    centro_id: nino.centro_id,
    nino_id: input.ninoId,
    entidad: input.entidad,
    registro_id: input.ninoId,
    payload: input.payload as Json,
    solicitado_por: input.usuarioId,
  })
  if (error) {
    if (error.code === '42501') return { ok: false, error: 'alta.errors.no_autorizado' }
    return { ok: false, error: 'admin.pendientes.errors.registro' }
  }
  return { ok: true }
}
