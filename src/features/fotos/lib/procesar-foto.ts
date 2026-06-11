import 'server-only'

import { createHash } from 'node:crypto'

import decode from 'heic-decode'
import sharp from 'sharp'

import { MAX_BYTES_FOTO } from '../types'

/**
 * Pipeline de procesado de una foto (F10-1, spec §Comportamiento 1 + §Privacidad).
 *
 * Por cada binario subido:
 *  1. Revalida el **tipo real** (no el MIME declarado) por magic bytes / `sharp`.
 *  2. Para **HEIC/HEIF** decodifica a **píxeles RGBA crudos** con `heic-decode`
 *     (libheif; el binario prebuilt de `sharp` no decodifica HEIC) y los alimenta a
 *     sharp en **raw** — SIN re-codificar a JPEG con `jpeg-js`. Esto evita la doble
 *     codificación y recorta el tiempo de procesado (~28 s → ~19 s en 12 MP), que
 *     era lo que disparaba el timeout de la función en Vercel.
 *  3. Aplica la **orientación EXIF** (`.rotate()`) y luego **descarta TODOS los
 *     metadatos** (sharp no los copia si no se pide `withMetadata()`), eliminando
 *     EXIF/geolocalización.
 *  4. Genera **original optimizado** (lado máx. 1600 px) + **miniatura** (lado máx.
 *     480 px), ambos **JPEG** — el bucket `aula-fotos` (F10-0) NO admite WebP en su
 *     `allowed_mime_types`; JPEG lo aceptan el bucket y el CHECK `media_mime_imagen`.
 *
 * Idempotente por `hash` (SHA-256 del original procesado): la misma foto reprocesada
 * produce el mismo hash, lo que permite descartar duplicados aguas arriba.
 */

/** Lado mayor del original optimizado (no se agranda si ya es menor). */
const MAX_LADO_ORIGINAL = 1600
/** Lado mayor de la miniatura para la rejilla. */
const MAX_LADO_MINIATURA = 480
const CALIDAD_JPEG = 82
const CALIDAD_MINIATURA = 70

export interface FotoProcesada {
  /** Original optimizado (JPEG), sin metadatos. */
  original: Buffer
  /** Miniatura (JPEG), sin metadatos. */
  miniatura: Buffer
  /** Dimensiones del original optimizado. */
  ancho: number
  alto: number
  /** Bytes del original optimizado. */
  bytes: number
  /** MIME de salida (siempre image/jpeg). */
  mime: 'image/jpeg'
  /** SHA-256 hex del original optimizado (idempotencia / dedup). */
  hash: string
}

export class FotoInvalidaError extends Error {
  /** Clave i18n (`fotos.validation.*` / `fotos.errors.*`). */
  readonly clave: string
  constructor(clave: string) {
    super(clave)
    this.name = 'FotoInvalidaError'
    this.clave = clave
  }
}

/**
 * Detecta HEIC/HEIF por la marca de la caja `ftyp` (ISO-BMFF). Los brands de
 * HEIC son `heic`, `heix`, `heim`, `heis`, `mif1`, `msf1`, `hevc`, `hevx`.
 */
function esHeic(buf: Buffer): boolean {
  if (buf.length < 12) return false
  if (buf.toString('ascii', 4, 8) !== 'ftyp') return false
  const brand = buf.toString('ascii', 8, 12)
  return ['heic', 'heix', 'heim', 'heis', 'mif1', 'msf1', 'hevc', 'hevx'].includes(brand)
}

/** Una sharp instance es de un solo uso → factoría para crear pipelines frescos. */
type CrearPipeline = () => sharp.Sharp

/**
 * Resuelve la entrada a una factoría de pipelines sharp. HEIC/HEIF → RGBA crudo
 * (heic-decode) servido en `raw`; el resto → el binario codificado, validando el
 * tipo real. Lanza `FotoInvalidaError` si no es una imagen procesable.
 */
async function crearFactoria(entrada: Buffer): Promise<CrearPipeline> {
  if (esHeic(entrada)) {
    let decoded: { width: number; height: number; data: ArrayBuffer }
    try {
      decoded = await decode({ buffer: entrada })
    } catch {
      throw new FotoInvalidaError('fotos.errors.heic_fallo')
    }
    const raw = Buffer.from(decoded.data)
    const { width, height } = decoded
    return () => sharp(raw, { raw: { width, height, channels: 4 } })
  }

  // Valida el tipo REAL con sharp (no el MIME declarado por el cliente).
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

/**
 * Procesa un binario de imagen ya cargado en memoria. Lanza `FotoInvalidaError`
 * (con clave i18n) si el tipo/tamaño no son válidos o la decodificación falla.
 */
export async function procesarFoto(entrada: Buffer): Promise<FotoProcesada> {
  if (entrada.byteLength > MAX_BYTES_FOTO) {
    throw new FotoInvalidaError('fotos.validation.tamano_max')
  }
  if (entrada.byteLength === 0) {
    throw new FotoInvalidaError('fotos.validation.tipo_no_permitido')
  }

  const crearPipeline = await crearFactoria(entrada)

  // Original optimizado: aplica orientación EXIF (no-op en raw, ya orientado por
  // libheif) y descarta metadatos (sin `withMetadata()` sharp NO copia EXIF/GPS).
  let original: Buffer
  let info: sharp.OutputInfo
  try {
    const out = await crearPipeline()
      .rotate()
      .resize(MAX_LADO_ORIGINAL, MAX_LADO_ORIGINAL, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: CALIDAD_JPEG, mozjpeg: true })
      .toBuffer({ resolveWithObject: true })
    original = out.data
    info = out.info
  } catch {
    throw new FotoInvalidaError('fotos.errors.procesado_fallo')
  }

  // Miniatura para la rejilla.
  let miniatura: Buffer
  try {
    miniatura = await crearPipeline()
      .rotate()
      .resize(MAX_LADO_MINIATURA, MAX_LADO_MINIATURA, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: CALIDAD_MINIATURA, mozjpeg: true })
      .toBuffer()
  } catch {
    throw new FotoInvalidaError('fotos.errors.procesado_fallo')
  }

  const hash = createHash('sha256').update(original).digest('hex')

  return {
    original,
    miniatura,
    ancho: info.width,
    alto: info.height,
    bytes: original.byteLength,
    mime: 'image/jpeg',
    hash,
  }
}
