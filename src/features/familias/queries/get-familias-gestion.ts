import 'server-only'

import { createClient } from '@/lib/supabase/server'

export interface FamiliaGestionItem {
  id: string
  etiqueta: string | null
  /** 'inactiva' = familia archivada (familias.deleted_at set). */
  estado: 'activa' | 'inactiva'
  /** Nombre del TITULAR a mostrar (tenga o no cuenta); si no hay titular, el primer tutor. */
  titularNombre: string | null
  hijosActivos: number
  numTutores: number
}

/**
 * F-6a — TODAS las familias del centro para el listado de gestión de Dirección. A diferencia
 * de `getFamiliasPorCentro` (F-2b-4-2, selector), NO excluye familias sin adulto con cuenta:
 * una familia con solo invitación pendiente también aparece. El titular a mostrar es el tutor
 * `rol_familia='titular'` (aunque no tenga `usuario_id`); si no hay titular, el primer tutor.
 * La RLS admin (`familias_select`/`familia_tutores_select` por `es_admin`) ya acota al centro
 * y no filtra `deleted_at`; no se toca RLS. Patrón de doble query de `get-familias.ts`.
 */
export async function getFamiliasParaGestion(centroId: string): Promise<FamiliaGestionItem[]> {
  const supabase = await createClient()

  const { data: familias } = await supabase
    .from('familias')
    .select('id, etiqueta, deleted_at')
    .eq('centro_id', centroId)

  if (!familias?.length) return []
  const ids = familias.map((f) => f.id)

  const [{ data: tutores }, { data: ninos }] = await Promise.all([
    supabase
      .from('familia_tutores')
      .select('familia_id, nombre_completo, rol_familia')
      .in('familia_id', ids)
      .is('deleted_at', null),
    supabase.from('ninos').select('familia_id').in('familia_id', ids).is('deleted_at', null),
  ])

  const tutoresPorFamilia = new Map<
    string,
    { nombre_completo: string | null; rol_familia: string }[]
  >()
  for (const t of tutores ?? []) {
    const arr = tutoresPorFamilia.get(t.familia_id) ?? []
    arr.push(t)
    tutoresPorFamilia.set(t.familia_id, arr)
  }
  const hijosPorFamilia = new Map<string, number>()
  for (const n of ninos ?? []) {
    hijosPorFamilia.set(n.familia_id, (hijosPorFamilia.get(n.familia_id) ?? 0) + 1)
  }

  return familias
    .map((f) => {
      const t = tutoresPorFamilia.get(f.id) ?? []
      const titular = t.find((x) => x.rol_familia === 'titular') ?? t[0]
      return {
        id: f.id,
        etiqueta: f.etiqueta,
        estado: f.deleted_at ? ('inactiva' as const) : ('activa' as const),
        titularNombre: titular?.nombre_completo ?? null,
        hijosActivos: hijosPorFamilia.get(f.id) ?? 0,
        numTutores: t.length,
      }
    })
    .sort((a, b) => (a.etiqueta ?? '').localeCompare(b.etiqueta ?? ''))
}
