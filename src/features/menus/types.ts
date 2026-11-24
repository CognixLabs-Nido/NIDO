import type { Database } from '@/types/db'

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
      /**
       * Niños cuyo «come sólidos» no se pudo leer (C, 2026-11-23). No salen en `filas`: el valor que
       * no hace daño es «no come sólidos». La pantalla los nombra.
       */
      sinComprobarSolidos: PaseDeListaComidaFila['nino'][]
    }

export interface PaseDeListaComidaFila {
  nino: {
    id: string
    nombre: string
    apellidos: string
    foto_url: string | null
  }
  alergiaGrave: boolean
  /**
   * Nadie ha contestado si come sólidos (sin registro vivo de datos pedagógicos, o con la lactancia
   * vacía: `nino_toma_comida_solida` NULL). El niño SALE en el pase, ni como que sí ni como que no, y
   * la pantalla lo dice antes de darle de comer (C, 2026-11-23 y 2026-11-24).
   */
  sinDatosPedagogicos: boolean
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
