/** TTL de los enlaces firmados del export (#4: ~24 h de margen de descarga). */
export const EXPORT_URL_TTL_SEGUNDOS = 24 * 60 * 60

/** Tipo de sujeto exportable (coincide con el CHECK de export_log). */
export type SujetoExport = 'usuario' | 'nino'

/** Referencia a un binario incluido en el export como enlace firmado (#4). */
export interface AdjuntoExport {
  descripcion: string
  bucket: string
  path: string
  url_firmada: string | null
  caduca_en: string
}

/** Documento de export del sujeto (se serializa a datos.json + se renderiza a HTML). */
export interface DocumentoExport {
  _meta: {
    generado_en: string
    derecho: 'acceso (art. 15) + portabilidad (art. 20)'
    formato: 'JSON estructurado + copia HTML legible'
    nota: string
    solicitado_por: string | null
  }
  usuario?: Record<string, unknown> | null
  hijos?: Array<Record<string, unknown>>
  nino?: Record<string, unknown> | null
}
