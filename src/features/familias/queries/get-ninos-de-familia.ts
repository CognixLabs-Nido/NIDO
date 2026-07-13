import 'server-only'

import { createClient } from '@/lib/supabase/server'

export interface NinoDeFamiliaItem {
  id: string
  nombre: string
  apellidos: string | null
  /** 'archivado' = niño dado de baja (ninos.deleted_at set). */
  estado: 'activo' | 'archivado'
  /** Aula de la matrícula activa (fecha_baja IS NULL); null si no la tiene o está archivado. */
  aula_nombre: string | null
}

/** Extrae `nombre` del embebido `aulas` (Supabase lo da como objeto o array según cardinalidad). */
function extraerNombreAula(raw: unknown): string | null {
  const obj = Array.isArray(raw) ? raw[0] : raw
  if (obj && typeof obj === 'object' && 'nombre' in obj) return (obj as { nombre: string }).nombre
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

  const { data: matriculas } = await supabase
    .from('matriculas')
    .select('nino_id, aulas(nombre)')
    .in(
      'nino_id',
      ninos.map((n) => n.id)
    )
    .is('fecha_baja', null)
    .is('deleted_at', null)

  const aulaPorNino = new Map<string, string>()
  for (const m of matriculas ?? []) {
    const nombre = extraerNombreAula(m.aulas)
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
