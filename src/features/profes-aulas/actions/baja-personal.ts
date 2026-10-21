'use server'

import { revalidatePath } from 'next/cache'

import { usuarioAdminEn } from '@/features/centros/contexto/roles-del-usuario'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

const RUTA = '/[locale]/admin/personal'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * La baja del personal del centro. Dos estados, y los dos dejan a la persona sin acceso:
 * la baja temporal (vuelve, y Dirección la reactiva aquí sin invitación) y la salida del centro
 * (definitiva: si vuelve, es un alta nueva con invitación). Los hace Dirección, como invitar a una
 * profe. La BD lo vuelve a comprobar: `dar_de_baja_profe` y `reactivar_profe` (`20261101130000`).
 */

/** Los errores de las dos RPC, por SQLSTATE (los fija la migración). */
function errorDeLaRpc(code: string | undefined): string {
  if (code === '42501') return 'admin.personal.errors.no_autorizado'
  if (code === 'P0002') return 'admin.personal.errors.no_encontrada'
  if (code === '55000') return 'admin.personal.errors.salio_del_centro'
  return 'admin.personal.errors.fallo'
}

async function darDeBaja(
  centroId: string,
  usuarioId: string,
  motivo: 'baja_temporal' | 'salida_centro'
): Promise<ActionResult<void>> {
  const supabase = await createClient()
  if (!UUID.test(usuarioId) || !(await usuarioAdminEn(supabase, centroId))) {
    return fail('admin.personal.errors.no_autorizado')
  }
  const { error } = await supabase.rpc('dar_de_baja_profe', {
    p_centro_id: centroId,
    p_usuario_id: usuarioId,
    p_motivo: motivo,
  })
  if (error) {
    logger.warn('darDeBaja: dar_de_baja_profe falló', error.code)
    return fail(errorDeLaRpc(error.code))
  }
  revalidatePath(RUTA, 'page')
  return ok(undefined)
}

export async function darDeBajaTemporal(
  centroId: string,
  usuarioId: string
): Promise<ActionResult<void>> {
  return darDeBaja(centroId, usuarioId, 'baja_temporal')
}

export async function darSalidaDelCentro(
  centroId: string,
  usuarioId: string
): Promise<ActionResult<void>> {
  return darDeBaja(centroId, usuarioId, 'salida_centro')
}

export async function reactivarPersonal(
  centroId: string,
  usuarioId: string
): Promise<ActionResult<void>> {
  const supabase = await createClient()
  if (!UUID.test(usuarioId) || !(await usuarioAdminEn(supabase, centroId))) {
    return fail('admin.personal.errors.no_autorizado')
  }
  const { error } = await supabase.rpc('reactivar_profe', {
    p_centro_id: centroId,
    p_usuario_id: usuarioId,
  })
  if (error) {
    logger.warn('reactivarPersonal: reactivar_profe falló', error.code)
    return fail(errorDeLaRpc(error.code))
  }
  revalidatePath(RUTA, 'page')
  return ok(undefined)
}
