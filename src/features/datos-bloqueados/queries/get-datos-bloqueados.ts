import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { Database } from '@/types/database'

type Funciones = Database['public']['Functions']
export type SujetoBloqueado = Funciones['sujetos_bloqueados']['Returns'][number]
export type AccesoBloqueado = Funciones['accesos_datos_bloqueados_centro']['Returns'][number]

/**
 * `no_autorizado`: no es la titular del centro (42501; también el superusuario y la directora).
 * `error`: cualquier otro fallo, que se dice y nunca se pinta como una lista vacía.
 */
export type Lectura<T> = { tipo: 'ok'; filas: T[] } | { tipo: 'no_autorizado' } | { tipo: 'error' }

/** Los sujetos con algo bloqueado en el centro. No enseña nada bloqueado y no deja registro. */
export async function getSujetosBloqueados(centroId: string): Promise<Lectura<SujetoBloqueado>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('sujetos_bloqueados', { p_centro_id: centroId })
  if (error) {
    if (error.code === '42501') return { tipo: 'no_autorizado' }
    logger.warn('datos bloqueados: sujetos_bloqueados', error.code)
    return { tipo: 'error' }
  }
  return { tipo: 'ok', filas: data ?? [] }
}

/** Quién ha visto lo bloqueado del centro, cuándo y por qué. */
export async function getAccesosBloqueados(centroId: string): Promise<Lectura<AccesoBloqueado>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('accesos_datos_bloqueados_centro', {
    p_centro_id: centroId,
  })
  if (error) {
    if (error.code === '42501') return { tipo: 'no_autorizado' }
    logger.warn('datos bloqueados: accesos_datos_bloqueados_centro', error.code)
    return { tipo: 'error' }
  }
  return { tipo: 'ok', filas: data ?? [] }
}

export type SujetoRetencion = Funciones['sujetos_retencion']['Returns'][number]
export type RetencionRegistro = Funciones['retenciones_centro']['Returns'][number]

/** Todos los sujetos del centro, para retenerlos: lo que ya se ve de ellos y si están retenidos. */
export async function getSujetosRetencion(centroId: string): Promise<Lectura<SujetoRetencion>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('sujetos_retencion', { p_centro_id: centroId })
  if (error) {
    if (error.code === '42501') return { tipo: 'no_autorizado' }
    logger.warn('retención: sujetos_retencion', error.code)
    return { tipo: 'error' }
  }
  return { tipo: 'ok', filas: data ?? [] }
}

/** Cada retención del centro, con quién la puso y quién la quitó, cuándo y por qué. */
export async function getRetencionesCentro(centroId: string): Promise<Lectura<RetencionRegistro>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('retenciones_centro', { p_centro_id: centroId })
  if (error) {
    if (error.code === '42501') return { tipo: 'no_autorizado' }
    logger.warn('retención: retenciones_centro', error.code)
    return { tipo: 'error' }
  }
  return { tipo: 'ok', filas: data ?? [] }
}
