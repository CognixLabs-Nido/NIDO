import type { CantidadComida, MomentoComida } from '@/features/agenda-diaria/schemas/agenda-diaria'

import type { DiaSemana, EstadoPlantillaMenu } from './schemas/menu'

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

export function fail(error: string): ActionResult<never> {
  return { success: false, error }
}

export interface PlantillaMenuRow {
  id: string
  centro_id: string
  nombre: string
  estado: EstadoPlantillaMenu
  vigente_desde: string | null
  vigente_hasta: string | null
  creada_por: string | null
  created_at: string
  updated_at: string
}

export interface PlantillaMenuDiaRow {
  id: string
  plantilla_id: string
  dia_semana: DiaSemana
  desayuno: string | null
  media_manana: string | null
  comida: string | null
  merienda: string | null
  updated_at: string
}

/**
 * Resultado de `public.menu_del_dia(centro, fecha)`. Cero filas en
 * sábado/domingo o si la plantilla publicada no cubre la fecha.
 */
export interface MenuDelDia {
  desayuno: string | null
  media_manana: string | null
  comida: string | null
  merienda: string | null
}

/**
 * Fila del pase de lista comida de un aula para (fecha, momento). La
 * `comida` es null si la profe aún no ha pasado lista (lazy). El menú
 * pre-cargado para esa fecha viene aparte.
 */
export interface NinoComidaResumen {
  nino: {
    id: string
    nombre: string
    apellidos: string
    fecha_nacimiento: string
    foto_url: string | null
  }
  comida: {
    id: string
    cantidad: CantidadComida
    descripcion: string | null
    observaciones: string | null
  } | null
  alertas: {
    alergia_grave: boolean
    medicacion: boolean
  }
}

export interface PaseDeListaComidaPayload {
  fecha: string
  momento: MomentoComida
  filas: NinoComidaResumen[]
  menu: MenuDelDia | null
}
