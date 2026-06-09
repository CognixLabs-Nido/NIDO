import type { Database } from '@/types/database'

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

export function fail(error: string): ActionResult<never> {
  return { success: false, error }
}

// --- Database row types ------------------------------------------------------
export type PlantillaInformeRow = Database['public']['Tables']['plantillas_informe']['Row']
export type EstadoPlantillaInforme = Database['public']['Enums']['estado_plantilla_informe']

// --- Estructura áreas → ítems (contenido JSONB de la plantilla) --------------
// Cada ítem se valora SIEMPRE con la escala fija de 3 (conseguido/en_proceso/
// no_iniciado): la escala no se configura por ítem; el editor solo pide el texto.
// `id` es la clave estable del ítem (se preserva al editar; el snapshot del
// informe la usará en F9-2 para las respuestas).
export interface ItemInforme {
  id: string
  texto: string
}

export interface AreaInforme {
  titulo: string
  items: ItemInforme[]
}

export type EstructuraInforme = AreaInforme[]

// --- View model para la UI ---------------------------------------------------
export interface PlantillaInformeItem {
  id: string
  titulo: string
  estado: EstadoPlantillaInforme
  estructura: EstructuraInforme
  archivada_at: string | null
  created_at: string
  updated_at: string
}
