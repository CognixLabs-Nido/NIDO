'use server'

import { revalidatePath } from 'next/cache'

import { sendInvitation } from '@/features/auth/actions/send-invitation'
import { usuarioAdminEn, usuarioResponsableEn } from '@/features/centros/contexto/roles-del-usuario'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { invitarDirectoraSchema, type InvitarDirectoraInput } from '../schemas/direccion'

const RUTA = '/[locale]/admin/direccion'

/**
 * La gestión de quién dirige el centro (PR 4 del modelo de roles). Invitar, dar de baja y
 * traspasar son de la admin del centro (`usuarioResponsableEn`); dejar la dirección, de cada
 * directora. La BD lo vuelve a comprobar: las RPC `traspasar_admin` y `baja_de_direccion`
 * (`20261031130000`) y la anti-escalada de `invitaciones`.
 */

/** Los errores de las dos RPC, por SQLSTATE (los fija la migración). */
function errorDeLaRpc(code: string | undefined): string {
  if (code === '42501') return 'direccion.errors.no_autorizado'
  if (code === '55000') return 'direccion.errors.admin_primero_traspasa'
  if (code === 'P0002') return 'direccion.errors.no_es_directora'
  if (code === '23514') return 'direccion.errors.solo_a_una_directora'
  if (code === '22023') return 'direccion.errors.otra_persona'
  return 'direccion.errors.fallo'
}

export async function invitarDirectora(
  input: InvitarDirectoraInput,
  centroId: string
): Promise<ActionResult<void>> {
  const parsed = invitarDirectoraSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'direccion.errors.fallo')

  const supabase = await createClient()
  if (!(await usuarioResponsableEn(supabase, centroId))) {
    return fail('direccion.errors.no_autorizado')
  }
  const r = await sendInvitation({
    email: parsed.data.email,
    rolObjetivo: 'directora',
    centroId,
    idioma: parsed.data.idioma,
  })
  if (!r.success) return fail(r.error)

  revalidatePath(RUTA, 'page')
  return ok(undefined)
}

export async function cancelarInvitacionDirectora(
  centroId: string,
  invitacionId: string
): Promise<ActionResult<void>> {
  const supabase = await createClient()
  if (!(await usuarioResponsableEn(supabase, centroId))) {
    return fail('direccion.errors.no_autorizado')
  }
  const { data, error } = await supabase
    .from('invitaciones')
    .delete()
    .eq('id', invitacionId)
    .eq('centro_id', centroId)
    .eq('rol_objetivo', 'directora')
    .is('accepted_at', null)
    .select('id')
    .maybeSingle()
  if (error) {
    logger.warn('cancelarInvitacionDirectora error', error.message)
    return fail('direccion.errors.fallo')
  }
  if (!data) return fail('direccion.errors.invitacion_no_encontrada')

  revalidatePath(RUTA, 'page')
  return ok(undefined)
}

/** La admin traspasa la administración a una directora del centro; ella queda como directora. */
export async function traspasarAdmin(
  centroId: string,
  nuevaAdminId: string
): Promise<ActionResult<void>> {
  const supabase = await createClient()
  if (!(await usuarioResponsableEn(supabase, centroId))) {
    return fail('direccion.errors.no_autorizado')
  }
  const { error } = await supabase.rpc('traspasar_admin', {
    p_centro_id: centroId,
    p_nueva_admin: nuevaAdminId,
  })
  if (error) {
    logger.warn('traspasarAdmin error', error.code)
    // Aquí el 42501 es «no tienes la fila de admin»: el superusuario pasa la guarda y no traspasa.
    if (error.code === '42501') return fail('direccion.errors.solo_la_admin_traspasa')
    return fail(errorDeLaRpc(error.code))
  }

  revalidatePath('/[locale]/admin', 'layout')
  return ok(undefined)
}

/** La admin (o el superusuario) da de baja a una directora del centro. */
export async function darDeBajaDirectora(
  centroId: string,
  usuarioId: string
): Promise<ActionResult<void>> {
  const supabase = await createClient()
  if (!(await usuarioResponsableEn(supabase, centroId))) {
    return fail('direccion.errors.no_autorizado')
  }
  const { error } = await supabase.rpc('baja_de_direccion', {
    p_centro_id: centroId,
    p_usuario_id: usuarioId,
  })
  if (error) {
    logger.warn('darDeBajaDirectora error', error.code)
    return fail(errorDeLaRpc(error.code))
  }

  revalidatePath(RUTA, 'page')
  return ok(undefined)
}

/**
 * Una directora deja la dirección del centro. La admin no: la RPC contesta 55000 y aquí sale el
 * aviso de que primero traspase la administración.
 */
export async function dejarLaDireccion(centroId: string): Promise<ActionResult<void>> {
  const supabase = await createClient()
  const usuarioId = await usuarioAdminEn(supabase, centroId)
  if (!usuarioId) return fail('direccion.errors.no_autorizado')
  const { error } = await supabase.rpc('baja_de_direccion', {
    p_centro_id: centroId,
    p_usuario_id: usuarioId,
  })
  if (error) {
    if (error.code !== '55000') logger.warn('dejarLaDireccion error', error.code)
    return fail(errorDeLaRpc(error.code))
  }

  revalidatePath('/[locale]', 'layout')
  return ok(undefined)
}
