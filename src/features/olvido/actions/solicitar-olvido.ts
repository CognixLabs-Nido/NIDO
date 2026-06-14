'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { ok, fail, type ActionResult } from '../types'

/**
 * Ejercicio del derecho al olvido (art. 17) sobre un NIÑO. Lo dispara la
 * dirección del centro (responsable del tratamiento); la RPC valida `es_admin`
 * vía `auth.uid()`. Soft-delete + fila en `olvido_solicitudes` con la gracia.
 *
 * @param inmediato purga inmediata a petición expresa del sujeto (#2): gracia = 0.
 */
export async function solicitarOlvidoNino(
  ninoId: string,
  inmediato = false
): Promise<ActionResult<string>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('solicitar_olvido_nino', {
    p_nino_id: ninoId,
    p_inmediato: inmediato,
  })
  if (error) {
    logger.error('olvido: solicitar_olvido_nino falló', error.message)
    return fail('No se pudo registrar la solicitud de olvido')
  }
  return ok(data as string)
}

/**
 * Ejercicio del derecho al olvido sobre un USUARIO (tutor/profe). El centro se
 * deriva de su rol; la RPC valida `es_admin` de ese centro vía `auth.uid()`.
 */
export async function solicitarOlvidoUsuario(
  usuarioId: string,
  inmediato = false
): Promise<ActionResult<string>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('solicitar_olvido_usuario', {
    p_usuario_id: usuarioId,
    p_inmediato: inmediato,
  })
  if (error) {
    logger.error('olvido: solicitar_olvido_usuario falló', error.message)
    return fail('No se pudo registrar la solicitud de olvido')
  }
  return ok(data as string)
}
