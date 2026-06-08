import 'server-only'

import { createClient } from '@/lib/supabase/server'

import type { AdministracionItem } from '../types'

/**
 * Registro de administraciones de una instancia de medicación (F8-3b), de la más
 * reciente a la más antigua. Bajo RLS: staff del niño y la familia del niño LEEN;
 * el resto no ve filas. Los nombres del staff (`usuarios`) pueden no resolverse por
 * RLS (p. ej. la familia no lee el perfil de la profe) → se devuelve '' y la UI
 * cae a una etiqueta genérica.
 */
export async function getAdministracionesPorAutorizacion(
  autorizacionId: string
): Promise<AdministracionItem[]> {
  const supabase = await createClient()
  const { data: rows } = await supabase
    .from('administraciones_medicacion')
    .select(
      'id, administrado_por, administrado_en, medicamento, dosis, notas, confirmado_por, confirmado_at'
    )
    .eq('autorizacion_id', autorizacionId)
    .order('administrado_en', { ascending: false })
  if (!rows || rows.length === 0) return []

  const ids = Array.from(
    new Set(rows.flatMap((r) => [r.administrado_por, r.confirmado_por].filter(Boolean) as string[]))
  )
  const nombre = new Map<string, string>()
  if (ids.length) {
    const { data: us } = await supabase.from('usuarios').select('id, nombre_completo').in('id', ids)
    for (const u of us ?? []) nombre.set(u.id, u.nombre_completo)
  }

  return rows.map((r) => ({
    id: r.id,
    administrado_por: r.administrado_por,
    administrado_por_nombre: nombre.get(r.administrado_por) ?? '',
    administrado_en: r.administrado_en,
    medicamento: r.medicamento,
    dosis: r.dosis,
    notas: r.notas,
    confirmado_por: r.confirmado_por,
    confirmado_por_nombre: r.confirmado_por ? (nombre.get(r.confirmado_por) ?? '') : null,
    confirmado_at: r.confirmado_at,
  }))
}
