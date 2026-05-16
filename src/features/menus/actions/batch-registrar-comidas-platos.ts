'use server'

import { revalidatePath } from 'next/cache'

import { asegurarAgenda } from '@/features/agenda-diaria/actions/upsert-agenda-cabecera'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import {
  batchRegistrarComidasPlatosSchema,
  type BatchRegistrarComidasPlatosInput,
} from '../schemas/menu'
import { fail, ok, type ActionResult, type TipoPlatoComida } from '../types'

/**
 * Guardado batch del pase de lista comida. Inserta o actualiza una fila
 * en `comidas` por (niño, plato), pre-rellenando `menu_dia_id` y
 * `tipo_plato`.
 *
 * Nota técnica importante (recordatorio Paso 4): el índice único parcial
 * de `comidas` es `(agenda_id, momento, tipo_plato) WHERE tipo_plato IS
 * NOT NULL`. Postgres exige especificar el predicate WHERE para inferir
 * el índice parcial en ON CONFLICT — pero PostgREST/supabase-js no
 * expone ese parámetro. Por eso esta action sigue el patrón
 * "lookup + split en UPDATE/INSERT" igual que `aplicarTipoARango` de
 * F4.5a: el índice protege a nivel BD ante condiciones de carrera,
 * mientras el server-side hace el split lógico.
 *
 * Errores tratados:
 *  - RLS rechaza (42501 / row-level security): fuera de ventana → error
 *    i18n específico para que la UI refresque a read-only.
 *  - Carrera con otra profe: el índice parcial fuerza 23505 unique_violation
 *    → fail genérico con sugerencia de recargar.
 */
export async function batchRegistrarComidasPlatos(
  input: BatchRegistrarComidasPlatosInput
): Promise<ActionResult<{ count: number }>> {
  const parsed = batchRegistrarComidasPlatosSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'menus.toasts.error_guardar')
  }

  const supabase = await createClient()

  // 1. Asegurar agendas para cada niño tocado (dedupe).
  const ninosUnicos = Array.from(new Set(parsed.data.filas.map((f) => f.nino_id)))
  const agendaIdByNino = new Map<string, string>()
  for (const ninoId of ninosUnicos) {
    const ag = await asegurarAgenda(ninoId, parsed.data.fecha)
    if (!ag) {
      return fail('menus.toasts.error_guardar')
    }
    agendaIdByNino.set(ninoId, ag)
  }

  const agendaIds = Array.from(agendaIdByNino.values())

  // 2. Lookup comidas existentes para (agenda_ids, momento, tipo_plato no nulo).
  const { data: existentes, error: lookupErr } = await supabase
    .from('comidas')
    .select('id, agenda_id, tipo_plato')
    .in('agenda_id', agendaIds)
    .eq('momento', parsed.data.momento)
    .not('tipo_plato', 'is', null)

  if (lookupErr) {
    logger.warn('batchRegistrarComidasPlatos lookup failed', lookupErr.message)
    return fail('menus.toasts.error_guardar')
  }

  const existenteByKey = new Map<string, string>() // key=`${agenda_id}|${tipo_plato}` → comida_id
  for (const e of (existentes ?? []) as Array<{
    id: string
    agenda_id: string
    tipo_plato: TipoPlatoComida
  }>) {
    existenteByKey.set(`${e.agenda_id}|${e.tipo_plato}`, e.id)
  }

  // 3. Split en UPDATE y INSERT por fila.
  const toInsert: Array<{
    agenda_id: string
    momento: typeof parsed.data.momento
    cantidad: string
    descripcion: string | null
    tipo_plato: TipoPlatoComida
    menu_dia_id: string
  }> = []
  const toUpdate: Array<{
    id: string
    cantidad: string
    descripcion: string | null
    menu_dia_id: string
  }> = []

  for (const f of parsed.data.filas) {
    const agendaId = agendaIdByNino.get(f.nino_id)!
    const existenteId = existenteByKey.get(`${agendaId}|${f.tipo_plato}`)
    if (existenteId) {
      toUpdate.push({
        id: existenteId,
        cantidad: f.cantidad,
        descripcion: f.descripcion,
        menu_dia_id: parsed.data.menu_dia_id,
      })
    } else {
      toInsert.push({
        agenda_id: agendaId,
        momento: parsed.data.momento,
        cantidad: f.cantidad,
        descripcion: f.descripcion,
        tipo_plato: f.tipo_plato,
        menu_dia_id: parsed.data.menu_dia_id,
      })
    }
  }

  // 4. UPDATEs (uno por fila — supabase-js no permite UPDATE bulk con valores distintos).
  for (const u of toUpdate) {
    const { error: updErr } = await supabase
      .from('comidas')
      .update({
        cantidad: u.cantidad as 'todo',
        descripcion: u.descripcion,
        menu_dia_id: u.menu_dia_id,
      })
      .eq('id', u.id)
    if (updErr) {
      logger.warn('batchRegistrarComidasPlatos update failed', updErr.message)
      if (updErr.code === '42501' || updErr.message.includes('row-level security')) {
        return fail('menus.toasts.error_fuera_de_ventana')
      }
      return fail('menus.toasts.error_guardar')
    }
  }

  // 5. INSERTs en bloque.
  if (toInsert.length > 0) {
    const { error: insErr } = await supabase.from('comidas').insert(
      toInsert.map((i) => ({
        agenda_id: i.agenda_id,
        momento: i.momento,
        cantidad: i.cantidad as 'todo',
        descripcion: i.descripcion,
        tipo_plato: i.tipo_plato,
        menu_dia_id: i.menu_dia_id,
      }))
    )
    if (insErr) {
      logger.warn('batchRegistrarComidasPlatos insert failed', insErr.message)
      if (insErr.code === '42501' || insErr.message.includes('row-level security')) {
        return fail('menus.toasts.error_fuera_de_ventana')
      }
      // 23505 unique_violation: carrera con otra profe.
      if (insErr.code === '23505') {
        return fail('menus.toasts.error_guardar')
      }
      return fail('menus.toasts.error_guardar')
    }
  }

  revalidatePath('/[locale]/teacher/aula/[id]/comida', 'page')
  revalidatePath('/[locale]/teacher/aula/[id]', 'page')
  revalidatePath('/[locale]/family/nino/[id]', 'page')

  return ok({ count: toUpdate.length + toInsert.length })
}
