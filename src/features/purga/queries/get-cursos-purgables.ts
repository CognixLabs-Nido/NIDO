import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

/** Años de retención: un curso es purgable cuando su fin fue hace ≥ 5 años (decisión H). */
export const ANIOS_RETENCION_CURSO = 5

export interface CursoPurgable {
  id: string
  nombre: string
  fechaFin: string
}

/** Fecha límite de purga: hoy menos `ANIOS_RETENCION_CURSO` años (YYYY-MM-DD). */
function fechaLimitePurga(): string {
  const hoy = new Date()
  const limite = new Date(
    Date.UTC(hoy.getUTCFullYear() - ANIOS_RETENCION_CURSO, hoy.getUTCMonth(), hoy.getUTCDate())
  )
  return limite.toISOString().slice(0, 10)
}

/**
 * F11-G-3 (decisión H) — cursos del centro cuyo fin fue hace ≥5 años, candidatos a purga
 * semimanual de documentos sensibles. La RLS de `cursos_academicos` limita al centro del
 * admin. Devuelve [] ante cualquier fallo (la sección no debe romper el perfil).
 */
export async function getCursosPurgables(): Promise<CursoPurgable[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('cursos_academicos')
    .select('id, nombre, fecha_fin')
    .lte('fecha_fin', fechaLimitePurga())
    .is('deleted_at', null)
    .order('fecha_fin', { ascending: true })
  if (error) {
    logger.warn('getCursosPurgables', error.message)
    return []
  }
  return (data ?? []).map((c) => ({ id: c.id, nombre: c.nombre, fechaFin: c.fecha_fin }))
}
