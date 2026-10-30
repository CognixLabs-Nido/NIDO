import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

type Fn = Database['public']['Functions']

export type PeticionCentro = Fn['peticiones_olvido_centro']['Returns'][number]
export type PeticionMia = Fn['mis_peticiones_olvido']['Returns'][number]
export type OpcionOlvido = Fn['opciones_olvido']['Returns'][number]

/** Un bloqueo o un aviso de lo que falta (`privado.olvido_bloqueos`). */
export interface ItemFalta {
  codigo: string
  n: number
  /** Solo en `retenido`: el tipo de motivo de la retención (20261206120000). */
  motivo_tipo?: string
}
export interface Falta {
  bloqueos: ItemFalta[]
  avisos: ItemFalta[]
}

/** Lo que falta de una petición pendiente; vacío si no está pendiente. */
export function leerFalta(falta: unknown): Falta {
  const f = (falta ?? {}) as Partial<Falta>
  return {
    bloqueos: Array.isArray(f.bloqueos) ? f.bloqueos : [],
    avisos: Array.isArray(f.avisos) ? f.avisos : [],
  }
}

/**
 * La deuda de la familia de quien pide el olvido (`privado.deuda_olvido`, 20261212120000): el
 * importe, los recibos y si la admin la puede dar por perdida; si no, por qué. NULL si la petición
 * no espera por una deuda.
 */
export interface Deuda {
  centimos: number
  n: number
  perdible: boolean
  noPerdible: 'otros_bloqueos' | 'recibo_borrador' | 'recibo_en_remesa' | null
}

export function leerDeuda(deuda: unknown): Deuda | null {
  if (!deuda || typeof deuda !== 'object') return null
  const d = deuda as Record<string, unknown>
  if (typeof d.centimos !== 'number' || typeof d.n !== 'number') return null
  const no = d.no_perdible
  return {
    centimos: d.centimos,
    n: d.n,
    perdible: d.perdible === true,
    noPerdible:
      no === 'otros_bloqueos' || no === 'recibo_borrador' || no === 'recibo_en_remesa' ? no : null,
  }
}

/** Las peticiones del centro, para la titular. `null` si no se pudieron leer. */
export async function getPeticionesCentro(centroId: string): Promise<PeticionCentro[] | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('peticiones_olvido_centro', { p_centro_id: centroId })
  if (error) {
    logger.warn('olvido: peticiones_olvido_centro', error.code)
    return null
  }
  return data ?? []
}

/** Las peticiones de la persona (las suyas y las de sus hijos). `null` si no se pudieron leer. */
export async function getMisPeticiones(): Promise<PeticionMia[] | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('mis_peticiones_olvido')
  if (error) {
    logger.warn('olvido: mis_peticiones_olvido', error.code)
    return null
  }
  return data ?? []
}

/** Lo que la persona puede pedir. Vacío si no se pudo leer (el perfil no ofrece nada). */
export async function getOpcionesOlvido(): Promise<OpcionOlvido[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('opciones_olvido')
  if (error) {
    logger.warn('olvido: opciones_olvido', error.code)
    return []
  }
  return data ?? []
}

/** Días enteros desde una fecha hasta ahora. */
export function diasDesde(fecha: string, ahora: Date = new Date()): number {
  return Math.floor((ahora.getTime() - new Date(fecha).getTime()) / 86_400_000)
}

/** Para el aviso del Inicio de la titular: las pendientes y los días de la más antigua. */
export function resumenPorRevisar(
  peticiones: PeticionCentro[],
  ahora: Date = new Date()
): { pendientes: number; diasMasAntigua: number } {
  const pendientes = peticiones.filter((p) => p.estado === 'pendiente')
  return {
    pendientes: pendientes.length,
    diasMasAntigua: pendientes.reduce(
      (max, p) => Math.max(max, diasDesde(p.solicitado_en, ahora)),
      0
    ),
  }
}
