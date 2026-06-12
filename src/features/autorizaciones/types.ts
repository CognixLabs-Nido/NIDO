import type { Database } from '@/types/database'

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

export function fail(error: string): ActionResult<never> {
  return { success: false, error }
}

// --- Database row types ------------------------------------------------------
export type AutorizacionRow = Database['public']['Tables']['autorizaciones']['Row']
export type AutorizacionInsert = Database['public']['Tables']['autorizaciones']['Insert']
export type FirmaRow = Database['public']['Tables']['firmas_autorizacion']['Row']
export type FirmaInsert = Database['public']['Tables']['firmas_autorizacion']['Insert']
export type AdministracionRow = Database['public']['Tables']['administraciones_medicacion']['Row']
export type TipoAutorizacion = Database['public']['Enums']['tipo_autorizacion']
export type AutorizacionEstado = Database['public']['Enums']['autorizacion_estado']
export type AutorizacionAmbito = Database['public']['Enums']['autorizacion_ambito']
export type FirmaDecision = Database['public']['Enums']['firma_decision']
export type PoliticaFirmantes = Database['public']['Enums']['politica_firmantes']
export type TipoVinculo = Database['public']['Enums']['tipo_vinculo']

// --- View models para la UI --------------------------------------------------

/** Estado de firma resultante de un niño dentro de una autorización. */
export type EstadoFirmaNino = 'firmado' | 'pendiente' | 'rechazado' | 'revocado' | 'parcial'

/** Persona autorizada a recoger (recogida, F8). DNI laxo; foto del DNI en F10-3. */
export interface PersonaAutorizada {
  nombre: string
  dni: string
  parentesco?: string
}

/**
 * Referencia a un adjunto sobre Storage atado a la firma (`firmas.datos.adjuntos`,
 * F10-3). En recogida: la **foto del DNI** de una persona autorizada. Se incluye en
 * `datos` al firmar → queda **atado al `texto_hash`**. `metadata.dni` lo enlaza con
 * la persona de la lista. **No** usa la tabla `media` (P-media-reuso).
 */
export interface AdjuntoFirma {
  bucket: string
  path: string
  hash: string
  metadata?: { tipo: 'dni_recogida'; dni?: string }
}

/** Persona autorizada con su foto de DNI opcional (estado del editor, F10-3). */
export interface PersonaAutorizadaEdit extends PersonaAutorizada {
  /** Adjunto del DNI ya subido (ruta+hash); se pliega a `datos.adjuntos` al firmar. */
  dni_adjunto?: AdjuntoFirma
  /** Enlace firmado del DNI subido, solo para el preview en el formulario. */
  dni_url?: string | null
}

/** Adjunto de DNI ya firmado, con enlaces para mostrar (vista detalle). */
export interface AdjuntoDniFirmado {
  /** DNI de la persona a la que pertenece (enlace con la lista). */
  dni?: string
  url: string | null
  urlMiniatura: string | null
}

/** Campos estructurados de una medicación (F8-3a). Adjunto/receta → F10. */
export interface MedicacionDatos {
  medicamento: string
  dosis: string
  via?: string
  pauta: string
  fecha_inicio: string
  fecha_fin: string
}

/** Una firma efectiva (última fila por firmante) para mostrar en el roster. */
export interface FirmaVigente {
  firmante_id: string
  firmante_nombre: string
  rol_firmante: TipoVinculo
  decision: FirmaDecision
  firmado_at: string
}

/** Un firmante requerido por la política, con su decisión vigente (o pendiente). */
export interface FirmanteRequerido {
  firmante_id: string
  firmante_nombre: string
  rol_firmante: TipoVinculo
  /** `null` = aún no se ha pronunciado (pendiente). */
  decision: FirmaDecision | null
  firmado_at: string | null
}

/** Fila del roster por niño: firmantes requeridos + estado agregado calculado. */
export interface RosterFirmaNino {
  nino_id: string
  nino_nombre: string
  estado: EstadoFirmaNino
  firmantes: FirmanteRequerido[]
}

/** Autorización tal y como la consume la lista. */
export interface AutorizacionItem {
  id: string
  tipo: TipoAutorizacion
  titulo: string
  estado: AutorizacionEstado
  texto_definitivo: boolean
  evento_id: string | null
  nino_id: string | null
  /** true = formato durable del catálogo (no firmable). false = instancia firmable. */
  es_plantilla: boolean
  /** Audiencia de la instancia (niño/aula/centro); null en plantillas y salida. */
  ambito: AutorizacionAmbito | null
  vigencia_desde: string | null
  vigencia_hasta: string | null
  created_at: string
  /** Solo en la vista familia: estado de firma del niño del tutor. */
  estado_firma?: EstadoFirmaNino
}

/** Plantilla durable del catálogo (es_plantilla=true) tal y como la consume la lista. */
export interface PlantillaCatalogoItem {
  id: string
  tipo: TipoAutorizacion
  titulo: string
  estado: AutorizacionEstado
  texto_definitivo: boolean
}

/** Plantilla publicada (tipo A) seleccionable en la acción «Enviar». */
export interface PlantillaEnviableItem {
  id: string
  tipo: TipoAutorizacion
  titulo: string
}

/**
 * Una administración de medicación para la lista del registro (F8-3b).
 * `confirmado_por` null = pendiente de confirmación por un 2.º staff distinto.
 */
export interface AdministracionItem {
  id: string
  administrado_por: string
  administrado_por_nombre: string
  administrado_en: string
  medicamento: string
  dosis: string
  notas: string | null
  confirmado_por: string | null
  confirmado_por_nombre: string | null
  confirmado_at: string | null
}

/** Detalle de una autorización + su roster por niño (filtrado por RLS). */
export interface AutorizacionDetalle {
  id: string
  tipo: TipoAutorizacion
  titulo: string
  texto: string
  texto_version: string
  texto_definitivo: boolean
  estado: AutorizacionEstado
  firmantes_requeridos: PoliticaFirmantes
  evento_id: string | null
  nino_id: string | null
  /** true = formato del catálogo (no firmable; se envía a una audiencia). */
  es_plantilla: boolean
  /** Audiencia de la instancia (niño/aula/centro); null en plantillas y salida. */
  ambito: AutorizacionAmbito | null
  /** Instancia A/B2 → la plantilla de la que deriva; null en plantillas/salida/legacy. */
  plantilla_id: string | null
  vigencia_desde: string | null
  vigencia_hasta: string | null
  /** ¿Es firmable AHORA? (publicada + texto_definitivo + dentro de vigencia; las plantillas NO). */
  firmable: boolean
  /** El usuario actual creó la autorización (gatea editar/publicar/anular junto a esAdmin). */
  es_autor: boolean
  roster: RosterFirmaNino[]
  /** Recogida: lista de personas de la última firma `firmado` (vigente), para display. */
  personas_vigentes?: PersonaAutorizada[]
  /** Recogida: fotos de DNI de la última firma `firmado`, firmadas para mostrar (F10-3). */
  adjuntos_recogida?: AdjuntoDniFirmado[]
  /** Medicación: campos de la última firma `firmado` (vigente), para display. */
  medicacion_vigente?: MedicacionDatos | null
  /** Recogida/medicación: ¿el hash de la última firma `firmado` cuadra con texto+datos? `null` si no hay firma. */
  integridad_ok?: boolean | null
}
