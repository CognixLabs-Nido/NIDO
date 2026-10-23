'use server'

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import { esAdminEn } from '@/features/centros/contexto/roles-del-usuario'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import { fail, ok, type ActionResult } from '../../centros/types'

type MetodoPago = Database['public']['Enums']['metodo_pago']
type Supabase = SupabaseClient<Database>

const inputSchema = z.object({
  familia_id: z.string().uuid(),
  metodo: z.enum(['sepa', 'efectivo', 'cheque_guarderia', 'transferencia']),
})

export type FijarMetodoPagoFamiliaInput = z.input<typeof inputSchema>

/**
 * PR-7 — Dirección cambia en la ficha cómo paga la familia (`familias.metodo_pago`). Al generar,
 * cada recibo regular coge este método salvo que su mes tenga una excepción
 * (`metodo_pago_familia`, el selector de la lista de recibos). UPDATE directo: la RLS
 * `familias_update` (`es_admin(centro_id)`) autoriza; gate admin explícito de defensa en
 * profundidad.
 */
export async function fijarMetodoPagoFamilia(
  input: FijarMetodoPagoFamiliaInput
): Promise<ActionResult<void>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return fail('admin.familias.metodo_pago.errors.invalido')

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData?.user) return fail('auth.invitation.errors.unauthenticated')

  // El centro es el DE LA FAMILIA, no el centro activo de la cookie. La RLS solo deja leer a
  // Dirección las familias de sus centros.
  const { data: familia } = await supabase
    .from('familias')
    .select('centro_id')
    .eq('id', parsed.data.familia_id)
    .maybeSingle()
  if (!familia) return fail('admin.familias.errors.no_encontrada')
  if (!(await esAdminEn(supabase, userData.user.id, familia.centro_id)))
    return fail('auth.invitation.errors.forbidden')

  const res = await fijarMetodoPagoFamiliaCore(supabase, parsed.data.familia_id, parsed.data.metodo)
  if (!res.success) return res

  revalidatePath('/[locale]/admin/familias/[id]', 'page')
  revalidatePath('/[locale]/admin/cuotas', 'page')
  return res
}

/**
 * Núcleo testeable. (1) Cambia el método de la ficha. (2) Lo refleja en los recibos regulares de
 * la familia que siguen en BORRADOR y cuyo mes no tiene excepción: el motor congela el método al
 * generar, y sin esto la lista de recibos enseñaría el viejo hasta recalcular. Un recibo validado
 * no se toca (queda congelado).
 */
export async function fijarMetodoPagoFamiliaCore(
  supabase: Supabase,
  familiaId: string,
  metodo: MetodoPago
): Promise<ActionResult<void>> {
  const { data, error } = await supabase
    .from('familias')
    .update({ metodo_pago: metodo })
    .eq('id', familiaId)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.warn('fijarMetodoPagoFamilia', error.message)
    if (error.code === '42501') return fail('admin.familias.errors.no_autorizado')
    return fail('admin.familias.metodo_pago.errors.guardado')
  }
  // RLS USING falso (familia de otro centro) → 0 filas, sin error.
  if (!data) return fail('admin.familias.errors.no_encontrada')

  // 2. Reflejar en los borradores sin excepción. Si falla, el método ya quedó en la ficha y el
  // borrador se corrige al regenerar: no es fatal.
  const [{ data: borradores, error: recErr }, { data: excepciones, error: excErr }] =
    await Promise.all([
      supabase
        .from('recibos')
        .select('id, anio, mes')
        .eq('familia_id', familiaId)
        .eq('estado', 'borrador')
        .eq('es_esporadico', false)
        .is('devuelto_de_recibo_id', null)
        .is('deleted_at', null),
      supabase
        .from('metodo_pago_familia')
        .select('anio, mes')
        .eq('familia_id', familiaId)
        .is('deleted_at', null),
    ])
  if (recErr || excErr) {
    logger.warn('fijarMetodoPagoFamilia borradores', (recErr ?? excErr)?.message)
    return ok(undefined)
  }

  const conExcepcion = new Set((excepciones ?? []).map((e) => `${e.anio}-${e.mes}`))
  const ids = (borradores ?? [])
    .filter((r) => !conExcepcion.has(`${r.anio}-${r.mes}`))
    .map((r) => r.id)
  if (ids.length > 0) {
    const { error: updErr } = await supabase.from('recibos').update({ metodo }).in('id', ids)
    if (updErr) logger.warn('fijarMetodoPagoFamilia reflejar', updErr.message)
  }

  return ok(undefined)
}
