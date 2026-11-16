import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/db'

import { deFilasNino, type GastosCurso } from '../lib/gastos'

type Client = SupabaseClient<Database>

export type GastosLeidos = { ok: true; gastos: GastosCurso[] } | { ok: false }

/**
 * Fase 9 — los gastos de gestión del niño (`gastos_gestion_nino`: su tutor legal y la Dirección),
 * con la sesión de quien mira. Si la lectura falla, `ok: false`: una lista vacía diría «el centro no
 * los cobra» y el paso desaparecería, y el alta se cerraría sin preguntarlos.
 */
export async function leerGastosGestion(supabase: Client, ninoId: string): Promise<GastosLeidos> {
  const { data, error } = await supabase.rpc('gastos_gestion_nino', { p_nino_id: ninoId })
  if (error) return { ok: false }
  return { ok: true, gastos: deFilasNino(data ?? []) }
}

/**
 * ¿El curso del alta tiene gastos de gestión? Para contar los pasos en la invitación, antes de
 * entrar (cliente de servicio: la familia aún no tiene sesión). Es el importe del curso de la
 * matrícula pendiente del niño, la misma condición que `privado.gastos_del_nino` para un niño en alta
 * (su primer curso, no cerrado, con importe).
 */
export async function cursoDelAltaTieneGastos(service: Client, ninoId: string): Promise<boolean> {
  const { data: m, error } = await service
    .from('matriculas')
    .select('curso_academico_id')
    .eq('nino_id', ninoId)
    .eq('estado', 'pendiente')
    .is('fecha_baja', null)
    .is('deleted_at', null)
  if (error) throw new Error(`cursoDelAltaTieneGastos matrícula: ${error.code ?? ''}`)
  const cursos = (m ?? []).map((x) => x.curso_academico_id)
  if (cursos.length === 0) return false
  const { data: g, error: gErr } = await service
    .from('gastos_gestion_curso')
    .select('id')
    .in('curso_academico_id', cursos)
    .limit(1)
  if (gErr) throw new Error(`cursoDelAltaTieneGastos importe: ${gErr.code ?? ''}`)
  return (g ?? []).length > 0
}
