'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { guardarMenuMesSchema, type GuardarMenuMesInput } from '../schemas/menu'
import { fail, ok, type ActionResult } from '../types'

/**
 * Guardado batch del editor de menú mensual. Recibe N menu_dia
 * modificados; hace UPSERT por (plantilla_id, fecha) con ON CONFLICT.
 *
 * Validaciones server-side:
 *  1. Zod garantiza shape de cada fila y span razonable.
 *  2. Se verifica que la plantilla existe (RLS impone admin del centro).
 *  3. Se valida que cada `fecha` cae dentro del mes/año de la plantilla
 *     padre — duplicado lógico del trigger BD pero permite mensaje UX
 *     claro (en vez de SQLSTATE crudo desde el cliente).
 */
export async function guardarMenuMes(
  input: GuardarMenuMesInput
): Promise<ActionResult<{ count: number }>> {
  const parsed = guardarMenuMesSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'menus.toasts.error_guardar')
  }

  if (parsed.data.menus.length === 0) {
    return ok({ count: 0 })
  }

  const supabase = await createClient()

  const { data: plantilla, error: pErr } = await supabase
    .from('plantillas_menu_mensual')
    .select('id, mes, anio')
    .eq('id', parsed.data.plantilla_id)
    .is('deleted_at', null)
    .maybeSingle()

  if (pErr || !plantilla) {
    logger.warn('guardarMenuMes plantilla lookup failed', pErr?.message)
    return fail('menus.toasts.error_guardar')
  }

  for (const m of parsed.data.menus) {
    const [anio, mes] = m.fecha.split('-').map((s) => Number(s))
    if (mes !== plantilla.mes || anio !== plantilla.anio) {
      return fail('menus.validation.fecha_fuera_del_mes')
    }
  }

  const rows = parsed.data.menus.map((m) => ({
    plantilla_id: parsed.data.plantilla_id,
    fecha: m.fecha,
    desayuno: m.desayuno,
    media_manana: m.media_manana,
    comida_primero: m.comida_primero,
    comida_segundo: m.comida_segundo,
    comida_postre: m.comida_postre,
    merienda: m.merienda,
  }))

  const { error } = await supabase
    .from('menu_dia')
    .upsert(rows, { onConflict: 'plantilla_id,fecha' })

  if (error) {
    logger.warn('guardarMenuMes upsert failed', error.message)
    if (error.code === '42501' || error.message.includes('row-level security')) {
      return fail('menus.toasts.error_guardar')
    }
    return fail('menus.toasts.error_guardar')
  }

  revalidatePath('/[locale]/admin/menus', 'page')
  revalidatePath(`/[locale]/admin/menus/${parsed.data.plantilla_id}`, 'page')
  revalidatePath('/[locale]/family/nino/[id]', 'page')
  revalidatePath('/[locale]/teacher/aula/[id]/comida', 'page')

  return ok({ count: rows.length })
}
