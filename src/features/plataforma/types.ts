/**
 * Una fila del panel de plataforma (`platform_metricas`, Fase 5): los recuentos de un centro vivo,
 * cada uno con su predicado de «activo» (ver la migración 20261103120000), y sus alertas. Los tipos
 * generados no marcan las columnas que pueden ser NULL en un `RETURNS TABLE`: aquí sí.
 */
export interface MetricasCentro {
  centroId: string
  nombre: string
  cursoActivo: string | null
  ninosMatriculados: number
  ninosEnAlta: number
  familias: number
  personal: number
  personalBajaTemporal: number
  direccion: number
  aulas: number
  invitacionesPendientes: number
  sinAdmin: boolean
  sinCursoActivo: boolean
  invitacionAdmin: 'pendiente' | 'caducada' | null
}

/** Las alertas que dejan un centro bloqueado (decisión del responsable), en el orden en que salen. */
export const ALERTAS_CENTRO = [
  'sin_admin',
  'invitacion_admin_pendiente',
  'invitacion_admin_caducada',
  'sin_curso_activo',
] as const

export type AlertaCentro = (typeof ALERTAS_CENTRO)[number]
