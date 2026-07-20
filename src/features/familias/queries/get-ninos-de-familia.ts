import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

export interface NinoDeFamiliaItem {
  id: string
  nombre: string
  apellidos: string | null
  /** 'archivado' = niño dado de baja (ninos.deleted_at set). */
  estado: 'activo' | 'archivado'
  /** Aula de la matrícula activa (fecha_baja IS NULL); null si no la tiene o está archivado. */
  aula_nombre: string | null
}

/**
 * Extrae `aulas.nombre` del embebido `aulas_curso` de una matrícula. Tras F11-H
 * (multicurso) la FK de `matriculas` es compuesta a `aulas_curso`, así que el aula
 * se anida: `aulas_curso.aulas.nombre` (cada nivel puede venir objeto o array).
 */
function extraerNombreAula(aulasCurso: unknown): string | null {
  const ac = Array.isArray(aulasCurso) ? aulasCurso[0] : aulasCurso
  const rawAula = ac && typeof ac === 'object' ? (ac as { aulas?: unknown }).aulas : null
  const aula = Array.isArray(rawAula) ? rawAula[0] : rawAula
  if (aula && typeof aula === 'object' && 'nombre' in aula)
    return (aula as { nombre: string }).nombre
  return null
}

/**
 * F-6a — hijos de una familia para su ficha de Dirección. Incluye ACTIVOS y ARCHIVADOS
 * (marca `estado` por `ninos.deleted_at`) — no existía una query "por familia" (las de hoy
 * listan por centro). El aula sale de la matrícula ACTIVA (fecha_baja IS NULL). La RLS admin
 * (`ninos_admin_all`) ya acota al centro y no filtra `deleted_at`; no se toca RLS.
 */
export async function getNinosDeFamilia(familiaId: string): Promise<NinoDeFamiliaItem[]> {
  const supabase = await createClient()
  const { data: ninos } = await supabase
    .from('ninos')
    .select('id, nombre, apellidos, deleted_at')
    .eq('familia_id', familiaId)
    .order('apellidos', { ascending: true })

  if (!ninos?.length) return []

  const { data: matriculas, error: errorMatriculas } = await supabase
    .from('matriculas')
    .select('nino_id, aulas_curso(aulas(nombre))')
    .in(
      'nino_id',
      ninos.map((n) => n.id)
    )
    .is('fecha_baja', null)
    .is('deleted_at', null)
  // Un embed roto hace fallar la query entera (data=null): sin este log, el aula saldría
  // null en silencio para toda la familia (misma regresión F11-H que en get-ninos).
  if (errorMatriculas) logger.warn('getNinosDeFamilia: matriculas', errorMatriculas.message)

  const aulaPorNino = new Map<string, string>()
  for (const m of matriculas ?? []) {
    const nombre = extraerNombreAula(m.aulas_curso)
    if (nombre) aulaPorNino.set(m.nino_id, nombre)
  }

  return ninos.map((n) => ({
    id: n.id,
    nombre: n.nombre,
    apellidos: n.apellidos,
    estado: n.deleted_at ? 'archivado' : 'activo',
    aula_nombre: aulaPorNino.get(n.id) ?? null,
  }))
}
