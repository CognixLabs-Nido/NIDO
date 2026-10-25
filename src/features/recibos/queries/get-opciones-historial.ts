import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

export interface OpcionHistorial {
  id: string
  etiqueta: string
}

export type OpcionesHistorialResult =
  | { ok: true; familias: OpcionHistorial[]; ninos: OpcionHistorial[] }
  | { ok: false }

/**
 * Las familias y los niños del centro para los filtros del histórico general (F-6): todos los vivos,
 * también los archivados (el histórico abarca varios cursos), por nombre. RLS: Dirección del centro.
 */
export async function getOpcionesHistorial(centroId: string): Promise<OpcionesHistorialResult> {
  const supabase = await createClient()
  const [familiasRes, ninosRes] = await Promise.all([
    supabase
      .from('familias')
      .select('id, etiqueta')
      .eq('centro_id', centroId)
      .is('deleted_at', null),
    supabase
      .from('ninos')
      .select('id, nombre, apellidos')
      .eq('centro_id', centroId)
      .is('deleted_at', null),
  ])
  const fallo = familiasRes.error ?? ninosRes.error
  if (fallo) {
    logger.warn('getOpcionesHistorial', fallo.message)
    return { ok: false }
  }
  const porNombre = (a: OpcionHistorial, b: OpcionHistorial) =>
    a.etiqueta.localeCompare(b.etiqueta, 'es-ES') || a.id.localeCompare(b.id)
  return {
    ok: true,
    familias: (familiasRes.data ?? [])
      .map((f) => ({ id: f.id, etiqueta: f.etiqueta ?? '—' }))
      .sort(porNombre),
    ninos: (ninosRes.data ?? [])
      .map((n) => ({ id: n.id, etiqueta: [n.nombre, n.apellidos].filter(Boolean).join(' ') }))
      .sort(porNombre),
  }
}
