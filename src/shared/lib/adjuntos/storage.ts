import 'server-only'

import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

type Client = SupabaseClient<Database>

/** Buckets de adjuntos (creados en F10-0, ADR-0045). */
export const BUCKET_NINOS_FOTOS = 'ninos-fotos'
export const BUCKET_RECOGIDA_ADJUNTOS = 'recogida-adjuntos'
export const BUCKET_CENTRO_ASSETS = 'centro-assets'
export const BUCKET_CARTILLA_VACUNAS = 'cartilla-vacunas'

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

/** Borra objetos de un bucket sin dejar huérfanos (best-effort). */
export async function borrarObjetosBucket(
  client: Client,
  bucket: string,
  paths: (string | null | undefined)[]
): Promise<void> {
  const limpias = paths.filter((p): p is string => typeof p === 'string' && p.length > 0)
  if (limpias.length === 0) return
  await client.storage.from(bucket).remove(limpias)
}

/** URL pública (bucket público) de un objeto. */
export function urlPublica(client: Client, bucket: string, path: string): string {
  return client.storage.from(bucket).getPublicUrl(path).data.publicUrl
}
