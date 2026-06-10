import 'server-only'

import { createClient } from '@/lib/supabase/server'

import {
  PREF_FIRMAS_VISTAS,
  PREF_INFORMES_VISTOS,
  PREF_NOTIF_VISTO,
  VENTANA_NOVEDADES_DIAS,
} from '../types'

export type RolNotif = 'admin' | 'profe' | 'tutor_legal' | 'autorizado'

/** Staff = ve/gestiona el ámbito del centro/aula (rutas admin de autorizaciones). */
export function esStaff(rol: RolNotif): boolean {
  return rol === 'admin' || rol === 'profe'
}

/** Segmento de ruta del dashboard/calendario según rol. */
export function segmentoRol(rol: RolNotif): 'admin' | 'teacher' | 'family' {
  if (rol === 'admin') return 'admin'
  if (rol === 'profe') return 'teacher'
  return 'family'
}

/** ISO del corte de ventana (hace N días): el feed solo mira novedades recientes. */
export function cutoffNovedades(): string {
  const d = new Date()
  d.setDate(d.getDate() - VENTANA_NOVEDADES_DIAS)
  return d.toISOString()
}

/** Marcador "todo lo anterior está visto" del usuario (ISO) o null si nunca lo abrió. */
export async function getVistoAt(): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('preferencias_usuario')
    .select('valor')
    .eq('clave', PREF_NOTIF_VISTO)
    .maybeSingle()
  return data?.valor ?? null
}

/**
 * Mapa `{ [autorizacion_id]: iso_visto_at }` del usuario: cuándo abrió cada
 * autorización. Vacío si nunca abrió ninguna o si el valor está corrupto.
 */
export async function getFirmasVistas(): Promise<Record<string, string>> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('preferencias_usuario')
    .select('valor')
    .eq('clave', PREF_FIRMAS_VISTAS)
    .maybeSingle()
  if (!data?.valor) return {}
  try {
    const parsed = JSON.parse(data.valor)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/**
 * Mapa `{ [informe_id]: iso_visto_at }` del usuario (F9-3): qué informes
 * publicados ha abierto la familia. Vacío si nunca abrió ninguno o si el valor
 * está corrupto. Solo se usa la PRESENCIA de la clave (Q8: no re-avisar al
 * republicar) — el instante es informativo.
 */
export async function getInformesVistos(): Promise<Record<string, string>> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('preferencias_usuario')
    .select('valor')
    .eq('clave', PREF_INFORMES_VISTOS)
    .maybeSingle()
  if (!data?.valor) return {}
  try {
    const parsed = JSON.parse(data.valor)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}
