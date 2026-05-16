import type { Database } from '@/types/database'

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

export function fail(error: string): ActionResult<never> {
  return { success: false, error }
}

export type EstadoPlantilla = Database['public']['Enums']['estado_plantilla_menu']
export type TipoPlatoComida = Database['public']['Enums']['tipo_plato_comida']
export type MomentoComida = Database['public']['Enums']['momento_comida']
export type CantidadComida = Database['public']['Enums']['cantidad_comida']

export type PlantillaMenuRow = Database['public']['Tables']['plantillas_menu_mensual']['Row']
export type MenuDiaRow = Database['public']['Tables']['menu_dia']['Row']

/** Pareja plantilla + sus filas menu_dia para el editor mensual. */
export interface PlantillaConMenus {
  plantilla: PlantillaMenuRow
  menus: MenuDiaRow[]
}

/**
 * Estado de carga del pase de lista comida en una fecha/momento concretos.
 * Empty states explícitos para que la UI los discrimine sin lógica
 * derivada (cada caso tiene su mensaje y, a veces, datos asociados).
 */
export type PaseDeListaComidaState =
  | { kind: 'centro_cerrado'; tipo: Database['public']['Enums']['tipo_dia_centro'] }
  | { kind: 'sin_plantilla_publicada' }
  | { kind: 'dia_sin_menu' }
  | {
      kind: 'listo'
      menu: MenuDiaRow
      filas: PaseDeListaComidaFila[]
      /** Map (nino_id, tipo_plato) → fila comidas existente (para pre-cargar). */
      existentes: Array<{
        nino_id: string
        tipo_plato: TipoPlatoComida
        cantidad: CantidadComida
        descripcion: string | null
        comida_id: string
      }>
    }

export interface PaseDeListaComidaFila {
  nino: {
    id: string
    nombre: string
    apellidos: string
    foto_url: string | null
  }
  alergiaGrave: boolean
}

/** Resumen del menú del día para el widget familia (B56). */
export interface MenuDelDiaParaFamilia {
  fecha: string
  desayuno: string | null
  media_manana: string | null
  comida_primero: string | null
  comida_segundo: string | null
  comida_postre: string | null
  merienda: string | null
}
