'use server'

import { revalidatePath } from 'next/cache'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { DatosDialogo } from '../components/DialogoOlvido'
import { avisarFamilia, avisarTitular, type EventoOlvido } from '../lib/avisar'
import { fail, ok, type ActionResult } from '../types'

/**
 * Las peticiones de olvido (docs/specs/olvido-peticiones.md). Cada acción llama a su función de
 * la BD con la sesión de quien la pide, que es quien comprueba quién puede qué; aquí solo se
 * traduce el error y se avisa: a la familia por correo en cada cambio, y a la titular con una
 * push genérica por cada petición nueva que no haya registrado ella.
 */

interface ErrorRpc {
  code?: string
  hint?: string
  message: string
}

/** El error de la función, por su HINT (lo fija la migración) o su SQLSTATE. */
function errorDeLaRpc(error: ErrorRpc): string {
  switch (error.hint) {
    case 'ya_pedida':
    case 'ya_borrado':
    case 'hay_bloqueos':
    case 'no_pendiente':
    case 'fuera_de_plazo':
    case 'motivo_obligatorio':
      return `olvido.errores.${error.hint}`
  }
  if (error.code === '42501') return 'olvido.errores.no_autorizado'
  return 'olvido.errores.fallo'
}

function revalidar() {
  revalidatePath('/[locale]/profile', 'page')
  revalidatePath('/[locale]/admin/olvido', 'page')
}

async function avisar(solicitudId: string, evento: EventoOlvido): Promise<void> {
  await avisarFamilia(createServiceRoleClient(), solicitudId, evento)
}

/** Avisa de una petición nueva: acuse a la familia y, si no la registró la titular, push a ella. */
async function avisarNueva(solicitudId: string): Promise<void> {
  const service = createServiceRoleClient()
  await avisarFamilia(service, solicitudId, 'pedida')
  const { data } = await service
    .from('olvido_solicitudes')
    .select('centro_id, pedida_por_centro')
    .eq('id', solicitudId)
    .maybeSingle()
  if (data) await avisarTitular(service, data.centro_id)
}

/** `casilla`: que se borre en cuanto se confirme, sin los 7 días. */
export async function pedirOlvidoNino(
  ninoId: string,
  datos?: Partial<DatosDialogo>
): Promise<ActionResult<string>> {
  const inmediato = datos?.casilla === true
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('pedir_olvido_nino', {
    p_nino_id: ninoId,
    p_inmediato: inmediato,
  })
  if (error || !data) {
    if (error) logger.warn('olvido: pedir_olvido_nino', error.code)
    return fail(error ? errorDeLaRpc(error) : 'olvido.errores.fallo')
  }
  await avisarNueva(data)
  revalidar()
  return ok(data)
}

/** La propia persona, sobre su cuenta en un centro; la titular, en nombre de otra. */
export async function pedirOlvidoUsuario(
  usuarioId: string,
  centroId: string,
  datos?: Partial<DatosDialogo>
): Promise<ActionResult<string>> {
  const inmediato = datos?.casilla === true
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('pedir_olvido_usuario', {
    p_usuario_id: usuarioId,
    p_centro_id: centroId,
    p_inmediato: inmediato,
  })
  if (error || !data) {
    if (error) logger.warn('olvido: pedir_olvido_usuario', error.code)
    return fail(error ? errorDeLaRpc(error) : 'olvido.errores.fallo')
  }
  await avisarNueva(data)
  revalidar()
  return ok(data)
}

export async function retirarPeticionOlvido(solicitudId: string): Promise<ActionResult<void>> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('retirar_peticion_olvido', { p_solicitud_id: solicitudId })
  if (error) return fail(errorDeLaRpc(error))
  await avisar(solicitudId, 'retirada')
  revalidar()
  return ok(undefined)
}

export async function confirmarPeticionOlvido(solicitudId: string): Promise<ActionResult<void>> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('confirmar_peticion_olvido', {
    p_solicitud_id: solicitudId,
  })
  if (error) return fail(errorDeLaRpc(error))
  await avisar(solicitudId, 'confirmada')
  revalidar()
  return ok(undefined)
}

/** `texto`: el motivo, que la familia verá. Obligatorio. */
export async function rechazarPeticionOlvido(
  solicitudId: string,
  datos: Partial<DatosDialogo>
): Promise<ActionResult<void>> {
  const motivo = datos.texto ?? ''
  if (!motivo.trim()) return fail('olvido.errores.motivo_obligatorio')
  const supabase = await createClient()
  const { error } = await supabase.rpc('rechazar_peticion_olvido', {
    p_solicitud_id: solicitudId,
    p_motivo: motivo,
  })
  if (error) return fail(errorDeLaRpc(error))
  await avisar(solicitudId, 'rechazada')
  revalidar()
  return ok(undefined)
}

/** La nota para la familia no avisa por correo: la familia la ve en su perfil. */
export async function guardarNotaPeticionOlvido(
  solicitudId: string,
  datos: Partial<DatosDialogo>
): Promise<ActionResult<void>> {
  const nota = datos.texto ?? ''
  const supabase = await createClient()
  const { error } = await supabase.rpc('nota_peticion_olvido', {
    p_solicitud_id: solicitudId,
    p_nota: nota,
  })
  if (error) return fail(errorDeLaRpc(error))
  revalidar()
  return ok(undefined)
}

export async function deshacerConfirmacionOlvido(solicitudId: string): Promise<ActionResult<void>> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('deshacer_confirmacion_olvido', {
    p_solicitud_id: solicitudId,
  })
  if (error) return fail(errorDeLaRpc(error))
  await avisar(solicitudId, 'deshecha')
  revalidar()
  return ok(undefined)
}
