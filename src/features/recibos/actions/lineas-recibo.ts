'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { usuarioAdminEn } from '@/features/centros/contexto/roles-del-usuario'
import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import { falloDeLectura } from '@/shared/lib/frontera-lectura'
import { LecturaFallida } from '@/shared/lib/lectura-fallida'
import { lecturaFallidaTrasEscritura } from '@/shared/lib/tras-escritura'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/db'

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
): Promise<ActionResult<TrasLinea>> {
  const parsed = anadirSchema.safeParse(input)
  if (!parsed.success) return fail('recibos_panel.errors.linea_invalida')

  const supabase = await createClient()
  let recibo: ReciboBorrador | null
  try {
    recibo = await reciboBorradorRegular(supabase, parsed.data.reciboId)
  } catch (e) {
    return falloDeLectura(e)
  }
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

  const recalculado = await recalcularTotal(supabase, recibo.id)
  revalidatePath(RUTA, 'page')
  return ok(trasLinea(recalculado))
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
): Promise<ActionResult<TrasLinea>> {
  const parsed = editarSchema.safeParse(input)
  if (!parsed.success) return fail('recibos_panel.errors.linea_invalida')

  const supabase = await createClient()
  let linea: { recibo_id: string } | null
  try {
    linea = await lineaDeBorrador(supabase, parsed.data.lineaId)
  } catch (e) {
    return falloDeLectura(e)
  }
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
    // PR-14: la línea de una devolución arrastrada no se edita (su importe es la deuda).
    if (error.hint === 'linea_arrastre') return fail('recibos_panel.errors.linea_arrastre')
    // PR-1c: ni la del saldo a favor de un cheque (su importe es el sobrante).
    if (error.hint === 'linea_sobrante') return fail('recibos_panel.errors.linea_sobrante')
    if (error.code === 'P0001') return fail('recibos_panel.errors.no_borrador')
    return fail('recibos_panel.errors.linea_failed')
  }

  const recalculado = await recalcularTotal(supabase, linea.recibo_id)
  revalidatePath(RUTA, 'page')
  return ok(trasLinea(recalculado))
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
): Promise<ActionResult<{ reciboId: string; aviso?: typeof AVISO_TOTAL }>> {
  const parsed = crearConLineaSchema.safeParse(input)
  if (!parsed.success) return fail('recibos_panel.errors.linea_invalida')

  const supabase = await createClient()

  // El centro es el DE LA FAMILIA (multicentro · Fase 1), con admin en él: el familiaId viaja
  // desde el cliente y así no se crea un recibo de una familia de un centro donde no se dirige.
  const { data: familia, error: errorLectura } = await supabase
    .from('familias')
    .select('id, centro_id, metodo_pago')
    .eq('id', parsed.data.familiaId)
    .is('deleted_at', null)
    .maybeSingle()
  if (errorLectura) return fail('common.lectura_fallida')
  if (!familia || !(await usuarioAdminEn(supabase, familia.centro_id))) {
    return fail('recibos_panel.errors.no_autorizado')
  }
  const centroId = familia.centro_id

  // Un mes cerrado no admite recibos nuevos. El motor ya lo rechaza al regenerar; sin este
  // chequeo se podría colar un recibo por la puerta de atrás en un mes ya liquidado.
  // Si no se pudo saber, no se da por abierto (C, 2026-11-23).
  const { data: cerrado, error: errorCerrado } = await supabase.rpc('mes_cerrado', {
    p_centro_id: centroId,
    p_anio: parsed.data.anio,
    p_mes: parsed.data.mes,
  })
  if (errorCerrado) {
    logger.warn('crearReciboConLineaManual mes_cerrado', errorCerrado.message)
    return fail('recibos_panel.errors.linea_failed')
  }
  if (cerrado) return fail('recibos_panel.errors.mes_cerrado')

  // Hay UNIQUE(familia_id, anio, mes) para regulares: si alguien regeneró entre que se pintó
  // el panel y este clic, ya existe recibo y hay que editar ese, no crear otro.
  const { data: yaExiste, error: errorYaExiste } = await supabase
    .from('recibos')
    .select('id')
    .eq('familia_id', parsed.data.familiaId)
    .eq('anio', parsed.data.anio)
    .eq('mes', parsed.data.mes)
    .eq('es_esporadico', false)
    .is('devuelto_de_recibo_id', null)
    .is('deleted_at', null)
    .maybeSingle()
  if (errorYaExiste) return fail('common.lectura_fallida')
  if (yaExiste) return fail('recibos_panel.errors.recibo_ya_existe')

  // Método CONGELADO, igual que hace el motor al crear la carcasa: la excepción del mes si la
  // hay; si no, el de la ficha de la familia (PR-7).
  const { data: pref, error: errorPref } = await supabase
    .from('metodo_pago_familia')
    .select('metodo')
    .eq('familia_id', parsed.data.familiaId)
    .eq('anio', parsed.data.anio)
    .eq('mes', parsed.data.mes)
    .is('deleted_at', null)
    .maybeSingle()
  // Sin leer la excepción del mes, el recibo nacería con el de la ficha: no se crea.
  if (errorPref) {
    logger.warn('crearReciboConLineaManual excepción del mes', errorPref.message)
    return fail('recibos_panel.errors.linea_failed')
  }

  const { data: recibo, error: errorRecibo } = await supabase
    .from('recibos')
    .insert({
      centro_id: centroId,
      familia_id: parsed.data.familiaId,
      nino_id: null,
      anio: parsed.data.anio,
      mes: parsed.data.mes,
      metodo: pref?.metodo ?? familia.metodo_pago,
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
    const { error: errorRetirar } = await supabase.from('recibos').delete().eq('id', recibo.id)
    // Censo C: si tampoco se retira, el recibo queda creado y sin líneas. Se dice, para que no se cree otro.
    if (errorRetirar) {
      logger.error('crearReciboConLineaManual: la carcasa no se retiró', {
        code: errorRetirar.code,
      })
      return fail('recibos_panel.errors.recibo_vacio_creado')
    }
    if (errorLinea.code === '42501') return fail('recibos_panel.errors.no_autorizado')
    return fail('recibos_panel.errors.linea_failed')
  }

  const recalculado = await recalcularTotal(supabase, recibo.id)
  revalidatePath(RUTA, 'page')
  return ok({ reciboId: recibo.id, ...trasLinea(recalculado) })
}

/** F-4-4: borra una línea de un recibo en BORRADOR. Recalcula `total_centimos`. */
export async function borrarLineaRecibo(
  input: z.input<typeof borrarSchema>
): Promise<ActionResult<TrasLinea>> {
  const parsed = borrarSchema.safeParse(input)
  if (!parsed.success) return fail('recibos_panel.errors.linea_invalida')

  const supabase = await createClient()
  let linea: { recibo_id: string } | null
  try {
    linea = await lineaDeBorrador(supabase, parsed.data.lineaId)
  } catch (e) {
    return falloDeLectura(e)
  }
  if (!linea) return fail('recibos_panel.errors.no_borrador')

  const { error } = await supabase.from('lineas_recibo').delete().eq('id', parsed.data.lineaId)
  if (error) {
    logger.warn('borrarLineaRecibo', error.message)
    if (error.code === '42501') return fail('recibos_panel.errors.no_autorizado')
    // PR-14: la devolución de la línea no se pudo dejar sin resolver; no se borra nada.
    if (error.hint === 'arrastre_sin_reabrir') return fail('recibos_panel.errors.linea_failed')
    // PR-1c: el sobrante de la línea no se pudo dejar pendiente; no se borra nada.
    if (error.hint === 'sobrante_sin_reabrir') return fail('recibos_panel.errors.linea_failed')
    if (error.code === 'P0001') return fail('recibos_panel.errors.no_borrador')
    return fail('recibos_panel.errors.linea_failed')
  }

  const recalculado = await recalcularTotal(supabase, linea.recibo_id)
  revalidatePath(RUTA, 'page')
  return ok(trasLinea(recalculado))
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
  const { data, error } = await supabase
    .from('recibos')
    .select('id, centro_id, estado, es_esporadico, devuelto_de_recibo_id')
    .eq('id', reciboId)
    .is('deleted_at', null)
    .maybeSingle()
  // Censo C: una lectura caída no es «no es un borrador».
  if (error) throw new LecturaFallida('reciboBorradorRegular', error)
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
  const { data: linea, error } = await supabase
    .from('lineas_recibo')
    .select('recibo_id')
    .eq('id', lineaId)
    .maybeSingle()
  if (error) throw new LecturaFallida('lineaDeBorrador', error)
  if (!linea) return null
  const recibo = await reciboBorradorRegular(supabase, linea.recibo_id)
  return recibo ? { recibo_id: linea.recibo_id } : null
}

/**
 * Recalcula `recibos.total_centimos` como la suma de las líneas vivas del recibo. Devuelve `false` si NO
 * lo recalculó, y entonces quien llama lo dice (`AVISO_TOTAL`).
 *
 * Censo C (lineas-recibo 333 y 338; adelantado a B1 por Jose el 2026-11-26): con la relectura de las líneas
 * caída, `(lineas ?? [])` sumaba 0 y un recibo con líneas se quedaba en 0 €, con la acción contestando ok.
 * Ahora, sin las líneas leídas no se escribe ningún total. No para: la línea YA está guardada, y decir «no
 * se guardó» haría que se volviera a añadir (lo de después de una escritura: `lecturaFallidaTrasEscritura`).
 */
async function recalcularTotal(supabase: Supabase, reciboId: string): Promise<boolean> {
  const { data: lineas, error: errorLectura } = await supabase
    .from('lineas_recibo')
    .select('importe_centimos')
    .eq('recibo_id', reciboId)
  if (errorLectura || !lineas) {
    lecturaFallidaTrasEscritura('recalcularTotal: las líneas del recibo', errorLectura)
    return false
  }
  const total = lineas.reduce((acc, l) => acc + l.importe_centimos, 0)
  const { error } = await supabase
    .from('recibos')
    .update({ total_centimos: total })
    .eq('id', reciboId)
  if (error) {
    logger.error('recalcularTotal: el total no se escribió', { code: error.code ?? null })
    return false
  }
  return true
}

/** La línea se guardó y el total del recibo no se pudo recalcular: el que se ve no está al día. */
const AVISO_TOTAL = 'recibos_panel.avisos.total_sin_recalcular' as const
type TrasLinea = { aviso: typeof AVISO_TOTAL } | undefined
const trasLinea = (recalculado: boolean): TrasLinea =>
  recalculado ? undefined : { aviso: AVISO_TOTAL }
