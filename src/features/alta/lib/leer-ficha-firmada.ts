import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/db'

import { copiaFichaFirmadaSchema, type CopiaFichaFirmada } from './ficha-pdf/tipos'

/**
 * Leer la copia firmada de la ficha con la sesión de quien la pide (fase 10c). Las reglas son de la
 * base (`public.leer_ficha_firmada`, `20270131120000`): Dirección del centro o el tutor legal con el
 * permiso de la ficha médica; los dos bloqueos; el sello; y la fila en `lecturas_ficha_medica`.
 *
 * - `no_encontrada`: no existe, o quien la pide no puede leerla (la base no distingue, a propósito).
 * - `bloqueada`: la ficha médica está bloqueada tras el curso de la baja, o la firma por la retención.
 * - `error`: cualquier otra cosa, también un sello que no cuadra. Nunca se toma por «no hay copia».
 */
export type LecturaCopia =
  | { ok: true; copia: CopiaFichaFirmada }
  | { ok: false; motivo: 'no_encontrada' | 'bloqueada' | 'error' }

export async function leerFichaFirmada(
  sesion: SupabaseClient<Database>,
  firmaId: string
): Promise<LecturaCopia> {
  const { data, error } = await sesion.rpc('leer_ficha_firmada', { p_firma_id: firmaId })
  if (error) {
    if (error.code === '42501') return { ok: false, motivo: 'no_encontrada' }
    if (error.code === '55000') return { ok: false, motivo: 'bloqueada' }
    logger.error('ficha firmada: leer la copia', { code: error.code })
    return { ok: false, motivo: 'error' }
  }
  const r = copiaFichaFirmadaSchema.safeParse(data)
  if (!r.success) {
    logger.error('ficha firmada: la copia no tiene la forma esperada', {
      issues: r.error.issues.length,
    })
    return { ok: false, motivo: 'error' }
  }
  return { ok: true, copia: r.data }
}
