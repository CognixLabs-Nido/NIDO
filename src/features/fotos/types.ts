import type { Database } from '@/types/database'

// --- Result pattern (idéntico al resto de features) -------------------------
export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

export function fail(error: string): ActionResult<never> {
  return { success: false, error }
}

// --- Filas de BD ------------------------------------------------------------
export type PublicacionRow = Database['public']['Tables']['publicaciones']['Row']
export type MediaRow = Database['public']['Tables']['media']['Row']
export type MediaEtiquetaRow = Database['public']['Tables']['media_etiquetas']['Row']

// --- Límites cerrados en la spec (P4) ---------------------------------------
/** Tipos de entrada aceptados (el binario real se revalida server-side). */
export const MIME_FOTO_ENTRADA = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'] as const
export type MimeFotoEntrada = (typeof MIME_FOTO_ENTRADA)[number]

/**
 * MIME de salida tras procesar. **JPEG**: lo admiten tanto el CHECK `media_mime_imagen`
 * (jpeg|png|webp) como el `allowed_mime_types` del bucket `aula-fotos`
 * (jpeg|png|heic|heif), que NO incluye webp. Encaja con la normalización HEIC→JPG.
 */
export const MIME_FOTO_SALIDA = 'image/jpeg'

/**
 * Tope por foto: **4 MB**. Margen bajo el límite de **4,5 MB** del body de una
 * request a una función serverless de Vercel (la foto viaja en el multipart). Se
 * valida en cliente y servidor; la subida directa a Storage (para tamaños mayores)
 * queda para una iteración futura.
 */
export const MAX_BYTES_FOTO = 4 * 1024 * 1024
export const MAX_FOTOS_PUBLICACION = 20
export const MAX_TEXTO_PUBLICACION = 2000

/** Bucket privado del blog del aula (F10-0, ADR-0045). */
export const BUCKET_AULA_FOTOS = 'aula-fotos'

/** TTL de las URLs firmadas (~1 h, P4). */
export const SIGNED_URL_TTL_SEGUNDOS = 60 * 60

// --- View models de la UI ---------------------------------------------------
/** Un niño del aula elegible para etiquetar (matriculado activo + permiso). */
export interface NinoEtiquetable {
  id: string
  nombre: string
  apellidos: string
}

/**
 * Un niño matriculado activo del aula para la vista de fotos. `puedeAparecer`
 * decide si el selector lo ofrece (gate de etiquetado); los que no, solo sirven
 * para resolver nombres de etiquetas existentes (p. ej. permiso revocado luego).
 */
export interface NinoAulaFoto {
  id: string
  nombre: string
  apellidos: string
  puedeAparecer: boolean
}

/** Una foto procesada de una publicación, con sus enlaces firmados y etiquetas. */
export interface MediaItem {
  id: string
  ancho: number | null
  alto: number | null
  /** Enlace firmado (~1 h) de la miniatura para la rejilla. */
  urlMiniatura: string | null
  /** Enlace firmado (~1 h) del original optimizado. */
  url: string | null
  /** Ids de los niños etiquetados en esta foto. */
  etiquetas: string[]
}

/** Una publicación del blog del aula con sus fotos (vista de staff). */
export interface PublicacionItem {
  id: string
  texto: string | null
  autorId: string
  autorNombre: string | null
  createdAt: string
  updatedAt: string
  /** El usuario actual puede editar/borrar (autor o admin). */
  puedeGestionar: boolean
  media: MediaItem[]
}

/** Una foto para la vista de FAMILIA (solo lectura): sin etiquetas (privacidad). */
export interface MediaFamiliaItem {
  id: string
  ancho: number | null
  alto: number | null
  /** Enlace firmado (~1 h) de la miniatura para el feed. */
  urlMiniatura: string | null
  /** Enlace firmado (~1 h) del original (abrir/descargar). */
  url: string | null
}

/** Una publicación tal como la ve la FAMILIA (solo lectura, sin gestión ni etiquetas). */
export interface PublicacionFamiliaItem {
  id: string
  texto: string | null
  autorNombre: string | null
  createdAt: string
  media: MediaFamiliaItem[]
}
