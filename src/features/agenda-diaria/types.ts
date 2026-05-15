import type {
  CalidadSueno,
  CantidadComida,
  CantidadDeposicion,
  ConsistenciaDeposicion,
  EstadoGeneral,
  Humor,
  MomentoComida,
  TipoBiberon,
  TipoDeposicion,
} from './schemas/agenda-diaria'

// Patrón Result compartido (duplicado intencionalmente per feature, ver
// src/features/centros/types.ts).
export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

export function fail(error: string): ActionResult<never> {
  return { success: false, error }
}

// --- Filas de BD coladas en tipos legibles -----------------------------------
export interface AgendaRow {
  id: string
  nino_id: string
  fecha: string
  estado_general: EstadoGeneral | null
  humor: Humor | null
  observaciones_generales: string | null
  updated_at: string
}

export interface ComidaRow {
  id: string
  agenda_id: string
  momento: MomentoComida
  hora: string | null
  cantidad: CantidadComida
  descripcion: string | null
  observaciones: string | null
  updated_at: string
}

export interface BiberonRow {
  id: string
  agenda_id: string
  hora: string
  cantidad_ml: number
  tipo: TipoBiberon
  tomado_completo: boolean
  observaciones: string | null
  updated_at: string
}

export interface SuenoRow {
  id: string
  agenda_id: string
  hora_inicio: string
  hora_fin: string | null
  calidad: CalidadSueno | null
  observaciones: string | null
  updated_at: string
}

export interface DeposicionRow {
  id: string
  agenda_id: string
  hora: string | null
  tipo: TipoDeposicion
  consistencia: ConsistenciaDeposicion | null
  cantidad: CantidadDeposicion
  observaciones: string | null
  updated_at: string
}

// Estructura completa que devuelve `get-agenda-del-dia` para un niño y fecha.
export interface AgendaCompleta {
  cabecera: AgendaRow | null
  comidas: ComidaRow[]
  biberones: BiberonRow[]
  suenos: SuenoRow[]
  deposiciones: DeposicionRow[]
}

// Resumen ligero para la lista del aula (vista profe).
export interface NinoAgendaResumen {
  nino: {
    id: string
    nombre: string
    apellidos: string
    fecha_nacimiento: string
    foto_url: string | null
  }
  agenda_id: string | null
  counts: {
    comidas: number
    biberones: number
    suenos: number
    deposiciones: number
  }
  alertas: {
    alergia_grave: boolean
    medicacion: boolean
  }
}
