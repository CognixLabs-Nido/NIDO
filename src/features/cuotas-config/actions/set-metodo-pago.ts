'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { fail, ok, type ActionResult } from '@/features/centros/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

const RUTA = '/[locale]/admin/cuotas'
const VINCULO_LEGAL = ['tutor_legal_principal', 'tutor_legal_secundario'] as const

const inputSchema = z.object({
  centroId: z.string().uuid(),
  ninoId: z.string().uuid(),
  anio: z.number().int().min(2024).max(2100),
  mes: z.number().int().min(1).max(12),
  metodo: z.enum(['sepa', 'efectivo', 'transferencia']),
})

type MetodoPago = Database['public']['Enums']['metodo_pago']

/**
 * Fija el método de pago de un niño para un mes y lo COPIA a sus hermanos (niños que
 * comparten algún tutor legal) que aún NO tengan método ese mes — así no pisa elecciones
 * por-niño ya hechas (decisión H: "editable por niño"). Solo informativo en B-2; el
 * efecto (quién entra al XML) es de B-5.
 */
export async function setMetodoPago(
  centroId: string,
  ninoId: string,
  anio: number,
  mes: number,
  metodo: MetodoPago
): Promise<ActionResult<void>> {
  const parsed = inputSchema.safeParse({ centroId, ninoId, anio, mes, metodo })
  if (!parsed.success) return fail('cuotas_config.errors.invalid')

  const supabase = await createClient()

  // 1) Upsert del niño objetivo (sobrescribe su valor explícitamente).
  const r = await upsertMetodo(supabase, centroId, ninoId, anio, mes, metodo)
  if (!r.success) return r

  // 2) Hermanos: niños que comparten un tutor legal con el objetivo.
  const { data: tutores } = await supabase
    .from('vinculos_familiares')
    .select('usuario_id')
    .eq('nino_id', ninoId)
    .in('tipo_vinculo', VINCULO_LEGAL)
    .is('deleted_at', null)

  const tutorIds = [...new Set((tutores ?? []).map((t) => t.usuario_id))]
  if (tutorIds.length > 0) {
    const { data: hermanosVinc } = await supabase
      .from('vinculos_familiares')
      .select('nino_id')
      .in('usuario_id', tutorIds)
      .in('tipo_vinculo', VINCULO_LEGAL)
      .is('deleted_at', null)

    const hermanoIds = [...new Set((hermanosVinc ?? []).map((h) => h.nino_id))].filter(
      (id) => id !== ninoId
    )

    for (const hermanoId of hermanoIds) {
      const { data: yaTiene } = await supabase
        .from('metodo_pago_familia')
        .select('id')
        .eq('nino_id', hermanoId)
        .eq('anio', anio)
        .eq('mes', mes)
        .is('deleted_at', null)
        .maybeSingle()
      // Copia solo si el hermano no tiene método ese mes (no pisa elecciones por-niño).
      if (!yaTiene) await upsertMetodo(supabase, centroId, hermanoId, anio, mes, metodo)
    }
  }

  revalidatePath(RUTA, 'page')
  return ok(undefined)
}

async function upsertMetodo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  centroId: string,
  ninoId: string,
  anio: number,
  mes: number,
  metodo: MetodoPago
): Promise<ActionResult<void>> {
  const { data: existente, error: selErr } = await supabase
    .from('metodo_pago_familia')
    .select('id')
    .eq('nino_id', ninoId)
    .eq('anio', anio)
    .eq('mes', mes)
    .is('deleted_at', null)
    .maybeSingle()

  if (selErr) {
    logger.warn('setMetodoPago select', selErr.message)
    return fail('cuotas_config.errors.metodo_failed')
  }

  const { error } = existente
    ? await supabase.from('metodo_pago_familia').update({ metodo }).eq('id', existente.id)
    : await supabase
        .from('metodo_pago_familia')
        .insert({ centro_id: centroId, nino_id: ninoId, anio, mes, metodo })

  if (error) {
    logger.warn('setMetodoPago upsert', error.message)
    if (error.code === '42501') return fail('cuotas_config.errors.no_autorizado')
    return fail('cuotas_config.errors.metodo_failed')
  }
  return ok(undefined)
}
