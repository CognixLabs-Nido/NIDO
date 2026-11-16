'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import {
  fijarImporteCursoSchema,
  fijarImporteNinoSchema,
  marcarCobroSchema,
  type FijarImporteCursoInput,
  type FijarImporteNinoInput,
  type MarcarCobroInput,
} from '../schemas'

import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * Fase 9 — lo que hace Dirección con los gastos de gestión, siempre con su sesión: la base mira la
 * puerta (`es_admin`, 42501) y la auditoría queda a su nombre. Sin bloqueo ni «exento» (D5): cambia
 * el importe, lo pone a 0 o marca el cobro cuando quiere. Ningún recibo (D6).
 */

function errorDireccion(donde: string, error: { code?: string; hint?: string | null }): string {
  if (error.code === '42501') return 'alta.errors.no_autorizado'
  if (error.hint === 'curso_cerrado') return 'gastos_gestion.errors.curso_cerrado'
  if (error.hint === 'curso_sin_gastos') return 'gastos_gestion.errors.curso_sin_gastos'
  logger.warn(donde, error.code ?? 'sin_codigo')
  return 'gastos_gestion.errors.guardar'
}

function revalidar() {
  revalidatePath('/[locale]/admin/ninos/[id]', 'page')
  revalidatePath('/[locale]/admin/cuotas', 'page')
}

/** El importe que fija el centro para un curso (una propuesta); NULL lo quita. */
export async function fijarImporteCursoGastos(
  input: FijarImporteCursoInput
): Promise<ActionResult<void>> {
  const parsed = fijarImporteCursoSchema.safeParse(input)
  if (!parsed.success) return fail('gastos_gestion.errors.importe')
  const supabase = await createClient()
  const { error } = await supabase.rpc('fijar_gastos_gestion_curso', {
    p_curso_academico_id: parsed.data.curso_academico_id,
    p_importe_centimos: parsed.data.importe_centimos,
  })
  if (error) return fail(errorDireccion('fijar_gastos_gestion_curso', error))
  revalidar()
  return ok(undefined)
}

/** Otro importe para un niño, o 0; NULL vuelve al del curso. */
export async function fijarImporteNinoGastos(
  input: FijarImporteNinoInput
): Promise<ActionResult<void>> {
  const parsed = fijarImporteNinoSchema.safeParse(input)
  if (!parsed.success) return fail('gastos_gestion.errors.importe')
  const supabase = await createClient()
  const { error } = await supabase.rpc('fijar_importe_gastos_gestion', {
    p_nino_id: parsed.data.nino_id,
    p_curso_academico_id: parsed.data.curso_academico_id,
    p_importe_centimos: parsed.data.importe_centimos,
  })
  if (error) return fail(errorDireccion('fijar_importe_gastos_gestion', error))
  revalidar()
  return ok(undefined)
}

/** Marca (o desmarca) que se cobró. Que no esté cobrado no frena nada (D5). */
export async function marcarCobroGastos(input: MarcarCobroInput): Promise<ActionResult<void>> {
  const parsed = marcarCobroSchema.safeParse(input)
  if (!parsed.success) return fail('gastos_gestion.errors.invalido')
  const supabase = await createClient()
  const { error } = await supabase.rpc('marcar_cobro_gastos_gestion', {
    p_nino_id: parsed.data.nino_id,
    p_curso_academico_id: parsed.data.curso_academico_id,
    p_cobrado: parsed.data.cobrado,
  })
  if (error) return fail(errorDireccion('marcar_cobro_gastos_gestion', error))
  revalidar()
  return ok(undefined)
}
