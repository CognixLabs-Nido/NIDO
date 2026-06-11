import 'server-only'

import { createHash } from 'node:crypto'

import sharp from 'sharp'

import { esHeicBytes } from './es-heic'
import { MAX_BYTES_FOTO } from '../types'

/**
 * Pipeline de procesado de una foto (F10-1, spec §Comportamiento 1 + §Privacidad).
 *
 * **HEIC se decodifica en el CLIENTE** (navegador → JPEG, ver [BlogAulaCliente]): el
 * decode HEIC con libheif NO puede correr en la función serverless porque `@vercel/nft`
 * no traza el `.wasm` de libheif al bundle → ENOENT al primer decode → 500 en frío. Por
 * eso aquí el servidor solo recibe JPG/PNG; si pese a todo llega un HEIC, se rechaza con
 * mensaje claro (`fotos.errors.heic_servidor`) en vez de reintroducir libheif.
 *
 * Por cada binario subido:
 *  1. Revalida el **tipo real** (no el MIME declarado) por magic bytes / `sharp` y
 *     rechaza HEIC sin convertir.
 *  2. Aplica la **orientación EXIF** (`.rotate()`) y luego **descarta TODOS los
 *     metadatos** (sharp no los copia si no se pide `withMetadata()`), eliminando
 *     EXIF/geolocalización.
 *  3. Genera **original optimizado** (lado máx. 1600 px) + **miniatura** (lado máx.
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

/** Una sharp instance es de un solo uso → factoría para crear pipelines frescos. */
type CrearPipeline = () => sharp.Sharp

/**
 * Resuelve la entrada a una factoría de pipelines sharp validando el tipo real.
 * Rechaza HEIC sin convertir (la conversión va en el cliente, ver cabecera) y
 * cualquier binario que no sea una imagen procesable.
 */
async function crearFactoria(entrada: Buffer): Promise<CrearPipeline> {
  if (esHeicBytes(entrada)) {
    throw new FotoInvalidaError('fotos.errors.heic_servidor')
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

  // Original optimizado: aplica orientación EXIF (`.rotate()`) y descarta metadatos
  // (sin `withMetadata()` sharp NO copia EXIF/GPS).
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
