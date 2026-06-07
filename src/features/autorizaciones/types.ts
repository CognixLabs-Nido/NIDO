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
export type TipoAutorizacion = Database['public']['Enums']['tipo_autorizacion']
export type AutorizacionEstado = Database['public']['Enums']['autorizacion_estado']
export type AutorizacionAmbito = Database['public']['Enums']['autorizacion_ambito']
export type FirmaDecision = Database['public']['Enums']['firma_decision']
export type PoliticaFirmantes = Database['public']['Enums']['politica_firmantes']
export type TipoVinculo = Database['public']['Enums']['tipo_vinculo']

// --- View models para la UI --------------------------------------------------

/** Estado de firma resultante de un niño dentro de una autorización. */
export type EstadoFirmaNino = 'firmado' | 'pendiente' | 'rechazado' | 'revocado' | 'parcial'

/** Persona autorizada a recoger (recogida, F8). DNI laxo; foto → F10. */
export interface PersonaAutorizada {
  nombre: string
  dni: string
  parentesco?: string
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
  /** Recogida: ¿el hash de la última firma `firmado` cuadra con texto+lista? `null` si no hay firma. */
  integridad_ok?: boolean | null
}
