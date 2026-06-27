import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { EntidadCambio } from '../schemas'

export interface CambioPendienteItem {
  id: string
  entidad: EntidadCambio
  ninoNombre: string
  solicitante: string
  createdAt: string
  /** Resumen legible del cambio propuesto (claves del parche o "documento nuevo"). */
  resumen: string
}

function resumirPayload(entidad: string, payload: unknown): string {
  if (entidad === 'ninos_libro_familia' || entidad === 'datos_tutor_dni') {
    return 'documento'
  }
  if (payload && typeof payload === 'object') {
    const claves = Object.keys(payload as Record<string, unknown>).filter(
      (k) => k !== 'tipo_vinculo'
    )
    return claves.join(', ')
  }
  return ''
}

/**
 * F11-G-3 — cola de cambios PENDIENTES para la cola `/admin/pendientes`. La RLS de
 * `cambios_pendientes` ya filtra al centro del admin; aquí solo se ordena y se enriquece con
 * el nombre del niño y del solicitante. Devuelve [] ante cualquier fallo (la página no debe
 * romperse por un join).
 */
export async function listarCambiosPendientes(): Promise<CambioPendienteItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('cambios_pendientes')
    .select(
      'id, entidad, payload, created_at, nino:ninos(nombre), solicitante:usuarios!cambios_pendientes_solicitado_por_fkey(nombre_completo)'
    )
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: true })
  if (error) {
    logger.warn('listarCambiosPendientes', error.message)
    return []
  }
  return (data ?? []).map((r) => ({
    id: r.id,
    entidad: r.entidad as EntidadCambio,
    ninoNombre: r.nino?.nombre ?? '',
    solicitante: r.solicitante?.nombre_completo ?? '',
    createdAt: r.created_at,
    resumen: resumirPayload(r.entidad, r.payload),
  }))
}

/**
 * Contador de cambios pendientes para el badge del sidebar admin. La RLS limita a su centro;
 * `head: true` + `count: 'exact'` evita traer filas. 0 ante cualquier fallo.
 */
export async function contarCambiosPendientes(): Promise<number> {
  const supabase = await createClient()
  const { count, error } = await supabase
    .from('cambios_pendientes')
    .select('id', { count: 'exact', head: true })
    .eq('estado', 'pendiente')
  if (error) {
    logger.warn('contarCambiosPendientes', error.message)
    return 0
  }
  return count ?? 0
}
