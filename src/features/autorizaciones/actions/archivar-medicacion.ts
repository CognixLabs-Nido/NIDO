'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { revalidarAutorizaciones } from '../lib/server-helpers'
import { fail, ok, type ActionResult } from '../types'

/**
 * Archiva una pauta de medicación terminada (estado COMPARTIDO del centro). Delega
 * en el RPC `archivar_autorizacion` (SECURITY DEFINER), que autoriza a admin del
 * centro o profe del niño (la familia no) y solo toca las columnas de archivado.
 * `false` del RPC = sin permiso / no es medicación / no existe.
 */
export async function archivarMedicacion(autorizacionId: string): Promise<ActionResult<void>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('archivar_autorizacion', {
    p_autorizacion_id: autorizacionId,
  })

  if (error) {
    logger.warn('archivarMedicacion: rpc', error.message)
    return fail('autorizaciones.errors.archivar_fallo')
  }
  if (!data) return fail('autorizaciones.errors.archivar_no_permitido')

  revalidarAutorizaciones()
  return ok(undefined)
}
