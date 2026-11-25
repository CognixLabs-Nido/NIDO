import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/types/db'

import type { EntidadCambio } from '../schemas'
import { LecturaFallida } from '@/shared/lib/lectura-fallida'

type Client = SupabaseClient<Database>

/**
 * F11-G-3 — ¿el alta del niño YA está validada por la dirección? (existe una matrícula
 * vigente `'activa'`). Es la frontera de la decisión J: con el alta validada, las ediciones de
 * datos sensibles NO se aplican directas, sino que van a la cola `cambios_pendientes`.
 *
 * PR-D: misma definición que `alta_validada_de_nino` en BD, que las RPC de escritura del
 * tutor aplican como frontera. Con varias matrículas vigentes (multicurso, una por curso)
 * cuenta si ALGUNA es `activa`; antes `maybeSingle` daba error con dos filas → "no validada".
 */
export async function altaValidada(supabase: Client, ninoId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('matriculas')
    .select('id')
    .eq('nino_id', ninoId)
    .eq('estado', 'activa')
    .is('fecha_baja', null)
    .is('deleted_at', null)
    .limit(1)
  if (error) throw new LecturaFallida('altaValidada', error)
  return (data?.length ?? 0) > 0
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
  const { data: nino, error: errorLectura } = await supabase
    .from('ninos')
    .select('centro_id')
    .eq('id', input.ninoId)
    .maybeSingle()
  if (errorLectura) throw new LecturaFallida('registrarCambioPendiente', errorLectura)
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

/**
 * 2026-11-20 — ¿la FAMILIA tiene algún alta validada? Misma definición que
 * `privado.familia_alta_validada`, que es la frontera que aplica la base al mandato (es de la familia).
 * Las rutas del mandato lo miran ANTES de subir el PDF: con la familia validada, el PDF va a una ruta
 * nueva (sin sobrescribir el validado) y el mandato a la cola. Si esta lectura se equivoca, la base
 * contesta igual (`cola_validacion`).
 */
export async function familiaAltaValidada(
  supabase: Client,
  centroId: string,
  familiaId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('matriculas')
    .select('id, nino:ninos!inner(familia_id, centro_id)')
    .eq('nino.centro_id', centroId)
    .eq('nino.familia_id', familiaId)
    .eq('estado', 'activa')
    .is('fecha_baja', null)
    .is('deleted_at', null)
    .limit(1)
  if (error) throw new LecturaFallida('familiaAltaValidada', error)
  return (data?.length ?? 0) > 0
}
