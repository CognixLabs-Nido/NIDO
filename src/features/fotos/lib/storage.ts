import 'server-only'

import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import { BUCKET_AULA_FOTOS, SIGNED_URL_TTL_SEGUNDOS } from '../types'

type Client = SupabaseClient<Database>

/**
 * Prefijo de Storage de una publicación: `{centroId}/{aulaId}/{publicacionId}`.
 * Las políticas de `storage.objects` (F10-0) autorizan por los dos primeros
 * segmentos (`[1]=centroId`, `[2]=aulaId`).
 */
export function prefijoPublicacion(
  centroId: string,
  aulaId: string,
  publicacionId: string
): string {
  return `${centroId}/${aulaId}/${publicacionId}`
}

/**
 * R4 — ¿la ruta es de la publicación? Tiene que ser exactamente `{prefijo}/<nombre>.jpg`
 * con un único segmento final de [A-Za-z0-9_-] (sin `/` ni `..`), que es lo que construye
 * `rutasFotoNueva`. El `prefijo` sale de la publicación de la FILA (`prefijoPublicacion`),
 * nunca del input. Espejo del trigger `media_validar_ruta_trg`.
 */
export function rutaDeLaPublicacion(path: string, prefijo: string): boolean {
  const base = `${prefijo}/`
  return path.startsWith(base) && /^[A-Za-z0-9_-]+\.jpg$/.test(path.slice(base.length))
}

/**
 * Rutas de unas medias (original + miniatura) que se pueden borrar en Storage: solo las de
 * la publicación (`rutaDeLaPublicacion`). Sin prefijo (publicación no resuelta) no se borra
 * nada. Devuelve también cuántas se descartaron por ajenas, para registrarlo.
 */
export function rutasBorrables(
  medias: { path: string | null; path_miniatura: string | null }[],
  prefijo: string | null
): { rutas: string[]; ajenas: number } {
  const todas = medias
    .flatMap((m) => [m.path, m.path_miniatura])
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
  if (!prefijo) return { rutas: [], ajenas: todas.length }
  const rutas = todas.filter((p) => rutaDeLaPublicacion(p, prefijo))
  return { rutas, ajenas: todas.length - rutas.length }
}

/** Genera el par de rutas (original + miniatura) de una foto nueva, con uuid propio. */
export function rutasFotoNueva(prefijo: string): { original: string; miniatura: string } {
  const id = randomUUID()
  return {
    original: `${prefijo}/${id}.jpg`,
    miniatura: `${prefijo}/${id}_thumb.jpg`,
  }
}

/**
 * Firma en lote las rutas dadas (~1 h). Devuelve un mapa `path → url` (omite las
 * que fallen). Debe llamarse con un cliente **ya autorizado** a leer esas medias
 * (la RLS de `media`/`publicaciones` decide el acceso; aquí solo se firma). Para
 * cargas server-side se usa el service client tras autorizar (ADR-0027).
 */
export async function firmarRutas(client: Client, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (paths.length === 0) return out
  const { data } = await client.storage
    .from(BUCKET_AULA_FOTOS)
    .createSignedUrls(paths, SIGNED_URL_TTL_SEGUNDOS)
  for (const item of data ?? []) {
    if (item.signedUrl && item.path) out.set(item.path, item.signedUrl)
  }
  return out
}

/** Borra objetos del bucket del blog (original + miniatura) sin dejar huérfanos. */
export async function borrarObjetos(client: Client, paths: string[]): Promise<void> {
  const limpias = paths.filter((p): p is string => typeof p === 'string' && p.length > 0)
  if (limpias.length === 0) return
  await client.storage.from(BUCKET_AULA_FOTOS).remove(limpias)
}
