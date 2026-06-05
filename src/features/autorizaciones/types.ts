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
export type FirmaDecision = Database['public']['Enums']['firma_decision']
export type PoliticaFirmantes = Database['public']['Enums']['politica_firmantes']
export type TipoVinculo = Database['public']['Enums']['tipo_vinculo']

// --- View models para la UI --------------------------------------------------

/** Estado de firma resultante de un niño dentro de una autorización. */
export type EstadoFirmaNino = 'firmado' | 'pendiente' | 'rechazado' | 'revocado' | 'parcial'

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
  vigencia_desde: string | null
  vigencia_hasta: string | null
  created_at: string
  /** Solo en la vista familia: estado de firma del niño del tutor. */
  estado_firma?: EstadoFirmaNino
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
  vigencia_desde: string | null
  vigencia_hasta: string | null
  /** ¿Es firmable AHORA? (publicada + texto_definitivo + dentro de vigencia). */
  firmable: boolean
  /** El usuario actual creó la autorización (gatea editar/publicar/anular junto a esAdmin). */
  es_autor: boolean
  roster: RosterFirmaNino[]
}
