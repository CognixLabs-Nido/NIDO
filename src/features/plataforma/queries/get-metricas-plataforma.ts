import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { MetricasCentro } from '../types'

/**
 * Las métricas de todos los centros vivos para el panel de plataforma. Las calcula
 * `platform_metricas()` en la BD (`SECURITY DEFINER`, con `is_superadmin()` como primera
 * sentencia): con la sesión de cualquier otro, 42501. `null` si la lectura falla, para que la
 * página lo diga en vez de enseñar un panel vacío como si no hubiera centros.
 */
export async function getMetricasPlataforma(): Promise<MetricasCentro[] | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('platform_metricas')
  if (error) {
    logger.warn('getMetricasPlataforma: platform_metricas falló', { code: error.code })
    return null
  }
  return (data ?? []).map((f) => ({
    centroId: f.centro_id,
    nombre: f.nombre,
    cursoActivo: f.curso_activo ?? null,
    ninosMatriculados: f.ninos_matriculados,
    ninosEnAlta: f.ninos_en_alta,
    familias: f.familias,
    personal: f.personal,
    personalBajaTemporal: f.personal_baja_temporal,
    direccion: f.direccion,
    aulas: f.aulas,
    invitacionesPendientes: f.invitaciones_pendientes,
    sinAdmin: f.sin_admin,
    sinCursoActivo: f.sin_curso_activo,
    invitacionAdmin:
      f.invitacion_admin === 'pendiente' || f.invitacion_admin === 'caducada'
        ? f.invitacion_admin
        : null,
  }))
}
