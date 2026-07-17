'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const RUTA = '/[locale]/admin/cuotas'

type Supabase = SupabaseClient<Database>

const anadirSchema = z.object({
  reciboId: z.string().uuid(),
  descripcion: z.string().trim().min(1).max(200),
  cantidad: z.number().int().min(1).max(9999),
  precioUnitarioCentimos: z.number().int().min(-100_000_00).max(100_000_00),
  ninoId: z.string().uuid().nullable().optional(),
  conceptoId: z.string().uuid().nullable().optional(),
})

const editarSchema = z.object({
  lineaId: z.string().uuid(),
  descripcion: z.string().trim().min(1).max(200),
  cantidad: z.number().int().min(1).max(9999),
  precioUnitarioCentimos: z.number().int().min(-100_000_00).max(100_000_00),
})

const borrarSchema = z.object({ lineaId: z.string().uuid() })

/**
 * F-4-4: añade una línea a un recibo en BORRADOR (override puntual del mes; se pierde si se
 * regenera — la UI lo avisa). Verifica que el recibo sea regular y borrador (el freeze POR
 * ESTADO es la última red). Recalcula `total_centimos`. Solo admin (RLS).
 */
export async function anadirLineaRecibo(
  input: z.input<typeof anadirSchema>
): Promise<ActionResult<void>> {
  const parsed = anadirSchema.safeParse(input)
  if (!parsed.success) return fail('recibos_panel.errors.linea_invalida')

  const supabase = await createClient()
  const recibo = await reciboBorradorRegular(supabase, parsed.data.reciboId)
  if (!recibo) return fail('recibos_panel.errors.no_borrador')

  const importe = parsed.data.precioUnitarioCentimos * parsed.data.cantidad
  const { error } = await supabase.from('lineas_recibo').insert({
    centro_id: recibo.centro_id,
    recibo_id: recibo.id,
    nino_id: parsed.data.ninoId ?? null,
    concepto_id: parsed.data.conceptoId ?? null,
    descripcion: parsed.data.descripcion,
    cantidad: parsed.data.cantidad,
    precio_unitario_centimos: parsed.data.precioUnitarioCentimos,
    importe_centimos: importe,
  })
  if (error) {
    logger.warn('anadirLineaRecibo', error.message)
    if (error.code === '42501') return fail('recibos_panel.errors.no_autorizado')
    if (error.code === 'P0001') return fail('recibos_panel.errors.no_borrador')
    return fail('recibos_panel.errors.linea_failed')
  }

  await recalcularTotal(supabase, recibo.id)
  revalidatePath(RUTA, 'page')
  return ok(undefined)
}

/**
 * F-4-4: edita descripción/cantidad/precio de una línea de un recibo en BORRADOR.
 * Recalcula `total_centimos`.
 */
export async function editarLineaRecibo(
  input: z.input<typeof editarSchema>
): Promise<ActionResult<void>> {
  const parsed = editarSchema.safeParse(input)
  if (!parsed.success) return fail('recibos_panel.errors.linea_invalida')

  const supabase = await createClient()
  const linea = await lineaDeBorrador(supabase, parsed.data.lineaId)
  if (!linea) return fail('recibos_panel.errors.no_borrador')

  const importe = parsed.data.precioUnitarioCentimos * parsed.data.cantidad
  const { error } = await supabase
    .from('lineas_recibo')
    .update({
      descripcion: parsed.data.descripcion,
      cantidad: parsed.data.cantidad,
      precio_unitario_centimos: parsed.data.precioUnitarioCentimos,
      importe_centimos: importe,
    })
    .eq('id', parsed.data.lineaId)
  if (error) {
    logger.warn('editarLineaRecibo', error.message)
    if (error.code === '42501') return fail('recibos_panel.errors.no_autorizado')
    if (error.code === 'P0001') return fail('recibos_panel.errors.no_borrador')
    return fail('recibos_panel.errors.linea_failed')
  }

  await recalcularTotal(supabase, linea.recibo_id)
  revalidatePath(RUTA, 'page')
  return ok(undefined)
}

/** F-4-4: borra una línea de un recibo en BORRADOR. Recalcula `total_centimos`. */
export async function borrarLineaRecibo(
  input: z.input<typeof borrarSchema>
): Promise<ActionResult<void>> {
  const parsed = borrarSchema.safeParse(input)
  if (!parsed.success) return fail('recibos_panel.errors.linea_invalida')

  const supabase = await createClient()
  const linea = await lineaDeBorrador(supabase, parsed.data.lineaId)
  if (!linea) return fail('recibos_panel.errors.no_borrador')

  const { error } = await supabase.from('lineas_recibo').delete().eq('id', parsed.data.lineaId)
  if (error) {
    logger.warn('borrarLineaRecibo', error.message)
    if (error.code === '42501') return fail('recibos_panel.errors.no_autorizado')
    if (error.code === 'P0001') return fail('recibos_panel.errors.no_borrador')
    return fail('recibos_panel.errors.linea_failed')
  }

  await recalcularTotal(supabase, linea.recibo_id)
  revalidatePath(RUTA, 'page')
  return ok(undefined)
}

// ── helpers ──────────────────────────────────────────────────────────────────

interface ReciboBorrador {
  id: string
  centro_id: string
}

/** Recibo REGULAR en borrador, o null si no existe / no es editable. */
async function reciboBorradorRegular(
  supabase: Supabase,
  reciboId: string
): Promise<ReciboBorrador | null> {
  const { data } = await supabase
    .from('recibos')
    .select('id, centro_id, estado, es_esporadico, devuelto_de_recibo_id')
    .eq('id', reciboId)
    .is('deleted_at', null)
    .maybeSingle()
  if (
    !data ||
    data.estado !== 'borrador' ||
    data.es_esporadico ||
    data.devuelto_de_recibo_id != null
  ) {
    return null
  }
  return { id: data.id, centro_id: data.centro_id }
}

/** La línea + su recibo, solo si el recibo es un borrador regular editable. */
async function lineaDeBorrador(
  supabase: Supabase,
  lineaId: string
): Promise<{ recibo_id: string } | null> {
  const { data: linea } = await supabase
    .from('lineas_recibo')
    .select('recibo_id')
    .eq('id', lineaId)
    .maybeSingle()
  if (!linea) return null
  const recibo = await reciboBorradorRegular(supabase, linea.recibo_id)
  return recibo ? { recibo_id: linea.recibo_id } : null
}

/** Recalcula `recibos.total_centimos` como la suma de las líneas vivas del recibo. */
async function recalcularTotal(supabase: Supabase, reciboId: string): Promise<void> {
  const { data: lineas } = await supabase
    .from('lineas_recibo')
    .select('importe_centimos')
    .eq('recibo_id', reciboId)
  const total = (lineas ?? []).reduce((acc, l) => acc + l.importe_centimos, 0)
  const { error } = await supabase
    .from('recibos')
    .update({ total_centimos: total })
    .eq('id', reciboId)
  if (error) logger.warn('recalcularTotal', error.message)
}
