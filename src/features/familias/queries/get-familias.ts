import 'server-only'

import { createClient } from '@/lib/supabase/server'

import { elegirAdultoConCuenta, type TutorFamiliaMinimo } from '../lib/adulto-con-cuenta'

export interface FamiliaItem {
  id: string
  etiqueta: string | null
  /** 'inactiva' = familia archivada (deleted_at set); se puede reactivar al añadir hijo. */
  estado: 'activa' | 'inactiva'
  /** Nombre/email del adulto CON CUENTA a mostrar (titular preferido). Nunca null en la
   *  lista: solo se incluyen familias con ≥1 adulto con cuenta. */
  titularNombre: string | null
  titularEmail: string | null
  hijosActivos: number
}

/**
 * F-2b-4-2 — familias del centro (ACTIVAS e INACTIVAS/archivadas) para el selector de
 * "añadir hijo a familia existente". SOLO se incluyen familias con **≥1 adulto con
 * cuenta** (titular o segundo_tutor con `usuario_id`); una familia solo con invitación
 * pendiente (ningún `usuario_id`) queda fuera de este flujo.
 *
 * La RLS admin (`familias_select` / `familia_tutores_select` por `es_admin`) ya acota al
 * centro y NO filtra `deleted_at` → basta pedir todas las familias del centro. Patrón de
 * doble query de `get-ninos.ts`.
 */
export async function getFamiliasPorCentro(centroId: string): Promise<FamiliaItem[]> {
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
      .select('familia_id, usuario_id, nombre_completo, email, rol_familia')
      .in('familia_id', ids)
      .is('deleted_at', null),
    supabase.from('ninos').select('familia_id').in('familia_id', ids).is('deleted_at', null),
  ])

  const tutoresPorFamilia = new Map<string, TutorFamiliaMinimo[]>()
  for (const t of tutores ?? []) {
    const arr = tutoresPorFamilia.get(t.familia_id) ?? []
    arr.push(t)
    tutoresPorFamilia.set(t.familia_id, arr)
  }
  const hijosPorFamilia = new Map<string, number>()
  for (const n of ninos ?? []) {
    hijosPorFamilia.set(n.familia_id, (hijosPorFamilia.get(n.familia_id) ?? 0) + 1)
  }

  const items: FamiliaItem[] = []
  for (const f of familias) {
    const adulto = elegirAdultoConCuenta(tutoresPorFamilia.get(f.id) ?? [])
    if (!adulto) continue // sin adulto con cuenta → fuera de este flujo
    items.push({
      id: f.id,
      etiqueta: f.etiqueta,
      estado: f.deleted_at ? 'inactiva' : 'activa',
      titularNombre: adulto.nombreCompleto,
      titularEmail: adulto.email,
      hijosActivos: hijosPorFamilia.get(f.id) ?? 0,
    })
  }

  return items.sort((a, b) => (a.etiqueta ?? '').localeCompare(b.etiqueta ?? ''))
}
