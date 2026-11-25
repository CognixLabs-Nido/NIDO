import 'server-only'

import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/db'

type Client = SupabaseClient<Database>

/** Buckets de adjuntos (creados en F10-0, ADR-0045). */
export const BUCKET_NINOS_FOTOS = 'ninos-fotos'
export const BUCKET_RECOGIDA_ADJUNTOS = 'recogida-adjuntos'
export const BUCKET_CENTRO_ASSETS = 'centro-assets'
/** Avatar de usuario (bucket privado creado en F11-C-0; espejo de `ninos-fotos`). */
export const BUCKET_USUARIOS_FOTOS = 'usuarios-fotos'
/** Buckets de documentos del alta (PRIVADOS, application/pdf, creados en F11-G-0). */
export const BUCKET_LIBRO_FAMILIA = 'libro-familia'
export const BUCKET_DNI_TUTORES = 'dni-tutores'
/** Fase 7 (D8): la imagen de la tarjeta sanitaria del niño, un PDF en `{centro}/{niño}/`. */
export const BUCKET_SIP_NINOS = 'sip-ninos'
/** Fase 9 (D8): el justificante de los gastos de gestión, un PDF o una imagen en `{centro}/{niño}/`. */
export const BUCKET_JUSTIFICANTES_GESTION = 'justificantes-gestion'
export const BUCKET_MANDATO_SEPA = 'mandato-sepa'
/** El fichero pain.008 de cada versión de una remesa (R-1, `20261220120000`): privado, sin políticas para las sesiones. */
export const BUCKET_REMESAS_FICHEROS = 'remesas-ficheros'
/** Documentos del centro (20270101120000): privado y sin políticas; el fichero, por su sha256. */
export const BUCKET_DOCUMENTOS_CENTRO = 'documentos-centro'

/** TTL de las URLs firmadas de los buckets privados (~1 h, P4). */
export const SIGNED_URL_TTL_SEGUNDOS = 60 * 60

/** Par de rutas (original + miniatura) bajo un prefijo, con uuid propio. */
export function rutasConThumb(prefijo: string): { original: string; miniatura: string } {
  const id = randomUUID()
  return { original: `${prefijo}/${id}.jpg`, miniatura: `${prefijo}/${id}_thumb.jpg` }
}

/** Deriva la ruta de la miniatura a partir de la del original (`X.jpg` → `X_thumb.jpg`). */
export function rutaThumbDe(original: string): string {
  return original.replace(/\.jpg$/, '_thumb.jpg')
}

/**
 * Firma en lote rutas de un bucket privado (~1 h) → mapa `path → url` (omite las que
 * fallen). El cliente debe estar **ya autorizado** a leer esos objetos (la RLS de
 * `storage.objects` decide); para cargas server-side se usa el service client tras
 * autorizar (ADR-0027).
 */
export async function firmarRutasBucket(
  client: Client,
  bucket: string,
  paths: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const limpias = paths.filter((p): p is string => typeof p === 'string' && p.length > 0)
  if (limpias.length === 0) return out
  const { data } = await client.storage
    .from(bucket)
    .createSignedUrls(limpias, SIGNED_URL_TTL_SEGUNDOS)
  for (const item of data ?? []) {
    if (item.signedUrl && item.path) out.set(item.path, item.signedUrl)
  }
  return out
}

/** Firma una sola ruta (atajo). */
export async function firmarRuta(
  client: Client,
  bucket: string,
  path: string | null | undefined
): Promise<string | null> {
  if (!path) return null
  const m = await firmarRutasBucket(client, bucket, [path])
  return m.get(path) ?? null
}

/**
 * Borra objetos de un bucket. **Si Storage contesta con error, lanza**: el borrado no se da por
 * hecho (censo C, 2026-11-25). Antes devolvía `void` sin mirar el error, y el olvido, la retención y
 * el expediente seguían como si los ficheros (fotos, DNI, libro de familia) ya no estuvieran. Esos
 * tres borran el fichero ANTES que la fila y son reintentables: el que lanza para ese sujeto, y la
 * pasada siguiente lo vuelve a coger con la ruta todavía en la base.
 *
 * Las rutas de subida que sustituyen un fichero viejo la llaman con `.catch(() => undefined)` a
 * propósito: el nuevo ya está guardado y el fallo solo deja un fichero viejo de más (decisión de
 * Jose del 2026-11-25; lo que lo recoge es el barrido de huérfanos, `docs/specs/fallos-leidos-c.md`).
 * Una ruta que no existe no es un error: Storage la ignora, así que reintentar es seguro.
 */
export async function borrarObjetosBucket(
  client: Client,
  bucket: string,
  paths: (string | null | undefined)[]
): Promise<void> {
  const limpias = paths.filter((p): p is string => typeof p === 'string' && p.length > 0)
  if (limpias.length === 0) return
  const { error } = await client.storage.from(bucket).remove(limpias)
  if (error)
    throw new Error(`Storage ${bucket}: no se borraron ${limpias.length} objetos: ${error.message}`)
}

/** URL pública (bucket público) de un objeto. */
export function urlPublica(client: Client, bucket: string, path: string): string {
  return client.storage.from(bucket).getPublicUrl(path).data.publicUrl
}
