'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
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

/** A1: crear la carcasa del recibo + su primera línea manual, para una familia sin recibo. */
const crearConLineaSchema = z.object({
  familiaId: z.string().uuid(),
  anio: z.number().int().min(2024).max(2100),
  mes: z.number().int().min(1).max(12),
  descripcion: z.string().trim().min(1).max(200),
  cantidad: z.number().int().min(1).max(9999),
  precioUnitarioCentimos: z.number().int().min(-100_000_00).max(100_000_00),
  ninoId: z.string().uuid().nullable().optional(),
})

/**
 * F-4-4 · R-3: añade una línea a un recibo en BORRADOR. Nace `origen='manual'`, que es lo
 * que hace que el motor la RESPETE al regenerar (R-2). Sin esa marca caería en el default
 * 'automatico' y la primera regeneración se la llevaría por delante — que es justo lo que
 * pasaba antes de R-2, cuando el aviso de la UI decía "estas ediciones se pierden".
 * Verifica que el recibo sea regular y borrador (el freeze POR ESTADO es la última red).
 * Recalcula `total_centimos`. Solo admin (RLS).
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
    origen: 'manual',
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
 * F-4-4 · R-3: edita descripción/cantidad/precio de una línea de un recibo en BORRADOR.
 *
 * B1 — tocar una línea a mano la CONVIERTE en `origen='manual'`, venga de donde venga. Sin
 * eso, editar el importe de una línea del motor sería trabajo perdido: la siguiente
 * regeneración la borraría y la volvería a calcular con el valor del catálogo. Convertirla
 * hace que "lo tocado a mano se respeta" sea una regla única, sin excepciones que explicar.
 * Editar una que ya era manual la deja manual (el UPDATE es idempotente en esa columna).
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
      origen: 'manual',
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

/**
 * R-3 (decisión A1): crea el recibo BORRADOR de una familia que aparece «Sin cargos» y le
 * cuelga su primera línea manual, en un solo gesto.
 *
 * Por qué hace falta una acción aparte: el motor DESCARTA el recibo que se queda sin
 * ninguna línea, así que la familia sin conceptos no tiene fila donde escribir. La
 * alternativa era que el motor dejara recibos de 0 €, pero eso los mete en el panel y en
 * las remesas para nada. Aquí se crea la carcasa solo cuando alguien de verdad escribe algo.
 */
export async function crearReciboConLineaManual(
  input: z.input<typeof crearConLineaSchema>
): Promise<ActionResult<{ reciboId: string }>> {
  const parsed = crearConLineaSchema.safeParse(input)
  if (!parsed.success) return fail('recibos_panel.errors.linea_invalida')

  const centroId = await getCentroActualId()
  if (!centroId) return fail('recibos_panel.errors.no_autorizado')

  const supabase = await createClient()

  // Un mes cerrado no admite recibos nuevos. El motor ya lo rechaza al regenerar; sin este
  // chequeo se podría colar un recibo por la puerta de atrás en un mes ya liquidado.
  const { data: cerrado } = await supabase.rpc('mes_cerrado', {
    p_centro_id: centroId,
    p_anio: parsed.data.anio,
    p_mes: parsed.data.mes,
  })
  if (cerrado) return fail('recibos_panel.errors.mes_cerrado')

  // La familia tiene que ser de ESTE centro: el familiaId viaja desde el cliente y sin esto
  // se podría crear un recibo de una familia ajena con nuestro centro_id.
  const { data: familia } = await supabase
    .from('familias')
    .select('id')
    .eq('id', parsed.data.familiaId)
    .eq('centro_id', centroId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!familia) return fail('recibos_panel.errors.no_autorizado')

  // Hay UNIQUE(familia_id, anio, mes) para regulares: si alguien regeneró entre que se pintó
  // el panel y este clic, ya existe recibo y hay que editar ese, no crear otro.
  const { data: yaExiste } = await supabase
    .from('recibos')
    .select('id')
    .eq('familia_id', parsed.data.familiaId)
    .eq('anio', parsed.data.anio)
    .eq('mes', parsed.data.mes)
    .eq('es_esporadico', false)
    .is('devuelto_de_recibo_id', null)
    .is('deleted_at', null)
    .maybeSingle()
  if (yaExiste) return fail('recibos_panel.errors.recibo_ya_existe')

  // Método CONGELADO de la familia para el mes, igual que hace el motor al crear la carcasa.
  const { data: pref } = await supabase
    .from('metodo_pago_familia')
    .select('metodo')
    .eq('familia_id', parsed.data.familiaId)
    .eq('anio', parsed.data.anio)
    .eq('mes', parsed.data.mes)
    .is('deleted_at', null)
    .maybeSingle()

  const { data: recibo, error: errorRecibo } = await supabase
    .from('recibos')
    .insert({
      centro_id: centroId,
      familia_id: parsed.data.familiaId,
      nino_id: null,
      anio: parsed.data.anio,
      mes: parsed.data.mes,
      metodo: pref?.metodo ?? null,
      estado: 'borrador',
      total_centimos: 0,
      es_esporadico: false,
    })
    .select('id')
    .single()

  if (errorRecibo || !recibo) {
    logger.warn('crearReciboConLineaManual recibo', errorRecibo?.message)
    if (errorRecibo?.code === '42501') return fail('recibos_panel.errors.no_autorizado')
    if (errorRecibo?.code === '23505') return fail('recibos_panel.errors.recibo_ya_existe')
    return fail('recibos_panel.errors.linea_failed')
  }

  const importe = parsed.data.precioUnitarioCentimos * parsed.data.cantidad
  const { error: errorLinea } = await supabase.from('lineas_recibo').insert({
    centro_id: centroId,
    recibo_id: recibo.id,
    nino_id: parsed.data.ninoId ?? null,
    concepto_id: null,
    descripcion: parsed.data.descripcion,
    cantidad: parsed.data.cantidad,
    precio_unitario_centimos: parsed.data.precioUnitarioCentimos,
    importe_centimos: importe,
    origen: 'manual',
  })

  if (errorLinea) {
    logger.warn('crearReciboConLineaManual linea', errorLinea.message)
    // Sin la línea, la carcasa queda a 0 € y el panel volvería a decir "Sin cargos" con un
    // recibo vacío detrás. Se retira para no dejar basura a medias.
    await supabase.from('recibos').delete().eq('id', recibo.id)
    if (errorLinea.code === '42501') return fail('recibos_panel.errors.no_autorizado')
    return fail('recibos_panel.errors.linea_failed')
  }

  await recalcularTotal(supabase, recibo.id)
  revalidatePath(RUTA, 'page')
  return ok({ reciboId: recibo.id })
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
