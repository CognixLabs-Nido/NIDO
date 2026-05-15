import type { MotivoAusencia } from '../ausencias/schemas/ausencia'

import type { EstadoAsistencia } from './schemas/asistencia'

// Patrón Result compartido (duplicado intencionalmente per feature).
export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

export function fail(error: string): ActionResult<never> {
  return { success: false, error }
}

export interface AsistenciaRow {
  id: string
  nino_id: string
  fecha: string
  estado: EstadoAsistencia
  hora_llegada: string | null
  hora_salida: string | null
  observaciones: string | null
  registrada_por: string | null
  updated_at: string
}

/**
 * Fila del pase de lista del aula para una fecha concreta. La asistencia es
 * `null` si nadie ha pasado lista todavía (lazy, ADR-0015). Si hay una
 * ausencia activa para esa fecha, viene con motivo y badge.
 */
export interface NinoAsistenciaResumen {
  nino: {
    id: string
    nombre: string
    apellidos: string
    fecha_nacimiento: string
    foto_url: string | null
  }
  asistencia: AsistenciaRow | null
  ausencia: {
    id: string
    motivo: MotivoAusencia
    descripcion: string | null
  } | null
  alertas: {
    alergia_grave: boolean
    medicacion: boolean
  }
}

export interface ResumenAulaCount {
  aula_id: string
  aula_nombre: string
  presentes: number
  ausentes: number
  total: number
}
