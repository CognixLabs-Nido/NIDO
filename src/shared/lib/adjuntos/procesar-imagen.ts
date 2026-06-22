import 'server-only'

import { createHash } from 'node:crypto'

import sharp from 'sharp'

import { esHeicBytes } from '@/features/fotos/lib/es-heic'
import { FotoInvalidaError } from '@/features/fotos/lib/procesar-foto'

/**
 * Procesado de imagen para los **adjuntos sobre Storage de F10-3** (foto del niño,
 * logo del centro, foto del DNI de recogida). Reusa el criterio de F10-1: valida el
 * **tipo real** del binario (no el MIME declarado), **rechaza HEIC** con el mismo
 * mensaje (`fotos.validation.heic_no_soportado`) y **elimina EXIF/geolocalización**
 * (sharp no copia metadatos si no se pide `withMetadata()`). A diferencia del blog,
 * cada adjunto tiene su propio perfil de calidad/tamaño (ver más abajo).
 *
 * Estos adjuntos **no** usan la tabla `media` (campos propios — P-media-reuso).
 */

/** Tope por archivo: 4 MB (margen bajo el body de 4,5 MB de una función Vercel). */
export const MAX_BYTES_ADJUNTO = 4 * 1024 * 1024

export interface ImagenProcesada {
  /** Imagen optimizada, sin metadatos. */
  original: Buffer
  /** Miniatura (para rejillas/avatares); igual al original si el perfil no la genera. */
  miniatura: Buffer
  ancho: number
  alto: number
  bytes: number
  /** MIME de salida del original. */
  mime: 'image/jpeg' | 'image/png'
  /** SHA-256 hex del original procesado (integridad / dedup / atado al hash de firma). */
  hash: string
}

/** Resuelve la entrada validando el tipo real; rechaza HEIC y no-imagen. */
async function crearFactoria(entrada: Buffer): Promise<() => sharp.Sharp> {
  if (esHeicBytes(entrada)) {
    throw new FotoInvalidaError('fotos.validation.heic_no_soportado')
  }
  let formato: string | undefined
  try {
    formato = (await sharp(entrada).metadata()).format
  } catch {
    throw new FotoInvalidaError('fotos.validation.tipo_no_permitido')
  }
  if (!formato || !['jpeg', 'jpg', 'png', 'webp'].includes(formato)) {
    throw new FotoInvalidaError('fotos.validation.tipo_no_permitido')
  }
  return () => sharp(entrada)
}

function validarTamano(entrada: Buffer): void {
  if (entrada.byteLength > MAX_BYTES_ADJUNTO) {
    throw new FotoInvalidaError('fotos.validation.tamano_max')
  }
  if (entrada.byteLength === 0) {
    throw new FotoInvalidaError('fotos.validation.tipo_no_permitido')
  }
}

interface PerfilJpeg {
  maxLado: number
  calidad: number
  maxLadoMini: number
  calidadMini: number
}

/** Pipeline JPEG genérico (original + miniatura), sin EXIF. */
async function procesarJpeg(entrada: Buffer, p: PerfilJpeg): Promise<ImagenProcesada> {
  validarTamano(entrada)
  const crearPipeline = await crearFactoria(entrada)

  let original: Buffer
  let info: sharp.OutputInfo
  try {
    const out = await crearPipeline()
      .rotate()
      .resize(p.maxLado, p.maxLado, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: p.calidad, mozjpeg: true })
      .toBuffer({ resolveWithObject: true })
    original = out.data
    info = out.info
  } catch {
    throw new FotoInvalidaError('fotos.errors.procesado_fallo')
  }

  let miniatura: Buffer
  try {
    miniatura = await crearPipeline()
      .rotate()
      .resize(p.maxLadoMini, p.maxLadoMini, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: p.calidadMini, mozjpeg: true })
      .toBuffer()
  } catch {
    throw new FotoInvalidaError('fotos.errors.procesado_fallo')
  }

  return {
    original,
    miniatura,
    ancho: info.width,
    alto: info.height,
    bytes: original.byteLength,
    mime: 'image/jpeg',
    hash: createHash('sha256').update(original).digest('hex'),
  }
}

/**
 * **Foto del niño** (ficha, bucket privado `ninos-fotos`). Tamaño de perfil
 * (≤1024 px) + miniatura/avatar (≤320 px). JPEG, sin EXIF.
 */
export function procesarFotoNino(entrada: Buffer): Promise<ImagenProcesada> {
  return procesarJpeg(entrada, { maxLado: 1024, calidad: 82, maxLadoMini: 320, calidadMini: 72 })
}

/**
 * **Foto del DNI de recogida** (bucket privado `recogida-adjuntos`). Es un
 * **documento que debe quedar legible** → resolución alta (≤2200 px) y calidad alta
 * (sin comprimir en exceso). Igual quita EXIF. Genera una miniatura solo para el
 * listado; el original se sirve a tamaño completo bajo enlace firmado.
 */
export function procesarDocumento(entrada: Buffer): Promise<ImagenProcesada> {
  return procesarJpeg(entrada, { maxLado: 2200, calidad: 90, maxLadoMini: 480, calidadMini: 72 })
}

/**
 * **Avatar de usuario** (F11-C-3, bucket privado `usuarios-fotos`). Foto de perfil de
 * un adulto del personal/familia: tamaño de perfil (≤1024 px) + miniatura/avatar
 * (≤256 px) para el header. JPEG, sin EXIF, HEIC rechazado — mismo criterio que la
 * foto del niño.
 */
export function procesarFotoAvatar(entrada: Buffer): Promise<ImagenProcesada> {
  return procesarJpeg(entrada, { maxLado: 1024, calidad: 82, maxLadoMini: 256, calidadMini: 72 })
}

/**
 * **Logo del centro** (bucket público `centro-assets`, ADR-0010). Conserva la
 * **transparencia** (salida **PNG**, no JPEG), reescala a ≤480 px de lado, quita
 * metadatos. No genera miniatura (`miniatura` === `original`).
 */
export async function procesarLogo(entrada: Buffer): Promise<ImagenProcesada> {
  validarTamano(entrada)
  const crearPipeline = await crearFactoria(entrada)

  let original: Buffer
  let info: sharp.OutputInfo
  try {
    const out = await crearPipeline()
      .rotate()
      .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: true })
      .toBuffer({ resolveWithObject: true })
    original = out.data
    info = out.info
  } catch {
    throw new FotoInvalidaError('fotos.errors.procesado_fallo')
  }

  return {
    original,
    miniatura: original,
    ancho: info.width,
    alto: info.height,
    bytes: original.byteLength,
    mime: 'image/png',
    hash: createHash('sha256').update(original).digest('hex'),
  }
}
