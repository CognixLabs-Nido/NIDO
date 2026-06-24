import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

/**
 * F11-H: resuelve el nombre del aula (físico) por id. Necesario porque
 * `matriculas` ya no tiene FK directa a `aulas` (es compuesta a `aulas_curso`),
 * así que PostgREST no puede anidar `matriculas(... aula:aulas(nombre))`. Donde
 * antes se anidaba, ahora se recogen los `aula_id` y se resuelven con esta función.
 */
export async function getAulaNombresPorIds(
  supabase: SupabaseClient<Database>,
  aulaIds: Array<string | null | undefined>
): Promise<Map<string, string>> {
  const ids = [...new Set(aulaIds.filter((x): x is string => Boolean(x)))]
  if (ids.length === 0) return new Map()
  const { data } = await supabase.from('aulas').select('id, nombre').in('id', ids)
  return new Map(
    ((data ?? []) as Array<{ id: string; nombre: string }>).map((a) => [a.id, a.nombre])
  )
}
