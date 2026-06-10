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

// --- Informes de evolución (F9-2) -------------------------------------------
export type PeriodoInforme = Database['public']['Enums']['periodo_informe']
export type EstadoInforme = Database['public']['Enums']['estado_informe']
export type ValoracionItem = Database['public']['Enums']['valoracion_item_informe']

/** Los 4 períodos por curso, en orden de presentación. */
export const PERIODOS_INFORME: readonly PeriodoInforme[] = [
  'trimestre_1',
  'trimestre_2',
  'trimestre_3',
  'fin_curso',
]

/** Respuesta por ítem dentro de un informe: valoración (escala de 3) + comentario. */
export interface RespuestaItem {
  valoracion: ValoracionItem
  comentario?: string
}

/** Mapa `{ [item_id]: RespuestaItem }` — el contenido de `informes_evolucion.respuestas`. */
export type RespuestasInforme = Record<string, RespuestaItem>

/** Estado del informe de un niño para un período (en la lista del profe). */
export interface InformePeriodoEstado {
  /** id del informe si ya existe; null = «sin iniciar». */
  id: string | null
  estado: EstadoInforme | null
}

/** Un niño del aula con el estado de su informe por período. */
export interface NinoInformes {
  id: string
  nombre: string
  apellidos: string
  /** Estado por período (clave = período). */
  porPeriodo: Record<PeriodoInforme, InformePeriodoEstado>
}

/** Un aula del profe con sus niños y si el profe puede redactar (coordinadora/profesora). */
export interface AulaInformes {
  id: string
  nombre: string
  puedeRedactar: boolean
  ninos: NinoInformes[]
}

// --- Vista de familia (F9-3): solo informes publicados, agrupados ------------
/** Un informe publicado de un período (item de la lista de familia). */
export interface InformeFamiliaItem {
  id: string
  periodo: PeriodoInforme
  /** Siempre 'publicado' (la familia no ve borradores); se conserva para `fondoInforme`. */
  estado: EstadoInforme
  publicado_at: string | null
}

/** Los informes publicados de un niño en un curso académico concreto. */
export interface CursoInformesFamilia {
  cursoId: string
  /** Nombre del curso (p. ej. «2025-2026»); null si la familia no puede leerlo. */
  cursoNombre: string | null
  /** Informes del curso, ordenados por período. */
  items: InformeFamiliaItem[]
}

/** Un hijo con sus informes publicados agrupados por curso (histórico incluido). */
export interface NinoInformesFamilia {
  ninoId: string
  nombre: string
  apellidos: string
  /** Cursos con informes, del más reciente al más antiguo. */
  cursos: CursoInformesFamilia[]
}

/** Detalle de un informe para rellenar/leer (estructura congelada + respuestas). */
export interface InformeEvolucionDetalle {
  id: string
  nino_id: string
  nino_nombre: string
  periodo: PeriodoInforme
  estado: EstadoInforme
  estructura_snapshot: EstructuraInforme
  respuestas: RespuestasInforme
  observaciones_generales: string | null
  publicado_at: string | null
  notificado_at: string | null
  /** El usuario actual puede redactar/publicar (coordinadora/profesora o admin). */
  puedeRedactar: boolean
}
