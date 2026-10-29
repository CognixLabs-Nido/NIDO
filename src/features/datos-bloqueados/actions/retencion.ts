'use server'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fail, ok, PonerRetencionSchema, QuitarRetencionSchema, type ActionResult } from '../types'

type ErrorRpc = { code?: string; hint?: string | null }

function traducir(error: ErrorRpc, rpc: string): ActionResult<never> {
  if (error.code === '42501') return fail('datos_bloqueados.retencion.errores.no_autorizado')
  if (error.hint === 'motivo') return fail('datos_bloqueados.retencion.errores.motivo')
  if (error.hint === 'sujetos') return fail('datos_bloqueados.retencion.errores.sujetos')
  logger.warn(`retención: ${rpc}`, error.code)
  return fail('datos_bloqueados.retencion.errores.fallo')
}

/**
 * Retener a varios sujetos del centro (20261206120000): mientras lo están, no se destruye nada suyo
 * al vencer su plazo. Quién puede (solo la titular), el motivo y el registro los decide
 * `poner_retencion`, con la sesión de quien lo pide; todo o nada. Devuelve cuántas se han puesto:
 * los que ya estaban retenidos no cuentan.
 */
export async function ponerRetencion(input: unknown): Promise<ActionResult<number>> {
  const parsed = PonerRetencionSchema.safeParse(input)
  if (!parsed.success) return fail('datos_bloqueados.retencion.errores.motivo')
  const d = parsed.data
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('poner_retencion', {
    p_centro_id: d.centroId,
    p_sujetos: d.sujetos,
    p_motivo_tipo: d.motivoTipo,
    p_motivo: d.motivo,
  })
  if (error) return traducir(error, 'poner_retencion')
  if (typeof data !== 'number') return fail('datos_bloqueados.retencion.errores.fallo')
  return ok(data)
}

/** Quitar la retención a varios sujetos, con motivo. Devuelve cuántas se han quitado. */
export async function quitarRetencion(input: unknown): Promise<ActionResult<number>> {
  const parsed = QuitarRetencionSchema.safeParse(input)
  if (!parsed.success) return fail('datos_bloqueados.retencion.errores.motivo')
  const d = parsed.data
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('quitar_retencion', {
    p_centro_id: d.centroId,
    p_sujetos: d.sujetos,
    p_motivo: d.motivo,
  })
  if (error) return traducir(error, 'quitar_retencion')
  if (typeof data !== 'number') return fail('datos_bloqueados.retencion.errores.fallo')
  return ok(data)
}
