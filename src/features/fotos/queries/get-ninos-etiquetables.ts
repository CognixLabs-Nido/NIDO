import 'server-only'

import { createClient } from '@/lib/supabase/server'

import type { NinoAulaFoto } from '../types'

interface MatriculaJoinNino {
  ninos: {
    id: string
    nombre: string
    apellidos: string
    puede_aparecer_en_fotos: boolean
  } | null
}

/**
 * Niños matriculados **activos** del aula para la vista de fotos (Comportamiento 3).
 * Incluye a todos (con y sin permiso) para poder resolver nombres de etiquetas
 * existentes; `puedeAparecer` marca a los que el selector puede ofrecer (gate P2:
 * `puede_aparecer_en_fotos`). La RLS de `matriculas`/`ninos` acota a staff del aula.
 */
export async function getNinosAulaParaFotos(aulaId: string): Promise<NinoAulaFoto[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('matriculas')
    .select('ninos(id, nombre, apellidos, puede_aparecer_en_fotos)')
    .eq('aula_id', aulaId)
    .is('fecha_baja', null)
    .is('deleted_at', null)

  return ((data ?? []) as MatriculaJoinNino[])
    .map((m) => m.ninos)
    .filter((n): n is NonNullable<MatriculaJoinNino['ninos']> => n !== null)
    .map((n) => ({
      id: n.id,
      nombre: n.nombre,
      apellidos: n.apellidos,
      puedeAparecer: n.puede_aparecer_en_fotos === true,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
}
