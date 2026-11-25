import 'server-only'

import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/db'

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

/**
 * Borra fotos del blog con la SESIÓN de quien borra y devuelve las rutas que **siguen** en el bucket
 * (vacío = borradas). Se llama ANTES de borrar la fila (decisión de Jose del 2026-11-25: «borra el
 * fichero primero y la fila después»): si algo queda, la fila sigue con su ruta y se puede reintentar.
 *
 * Con la sesión, porque la política `aula_fotos_delete` autoriza lo mismo que la de la fila (admin
 * del centro o autor de la publicación, medido en producción el 2026-11-25): la base decide quién.
 * Pero Storage **no da error al negar un borrado**: contesta sin ese objeto. Por eso no se cree la
 * respuesta: se mira con el servicio si cada ruta sigue ahí. Un error de Storage, o no poder mirarlo,
 * lanza. Una ruta que ya no existía no cuenta como pendiente: reintentar es seguro.
 */
export async function borrarFotosDelBlog(
  sesion: Client,
  service: Client,
  paths: string[]
): Promise<string[]> {
  const limpias = [...new Set(paths.filter((p) => typeof p === 'string' && p.length > 0))]
  if (limpias.length === 0) return []
  const { error } = await sesion.storage.from(BUCKET_AULA_FOTOS).remove(limpias)
  if (error) throw new Error(`Storage ${BUCKET_AULA_FOTOS}: ${error.message}`)
  return rutasQueSiguen(service, limpias)
}

/** De unas rutas del blog, las que siguen en el bucket (por el listado de su carpeta). */
async function rutasQueSiguen(service: Client, rutas: string[]): Promise<string[]> {
  const porCarpeta = new Map<string, string[]>()
  for (const r of rutas) {
    const corte = r.lastIndexOf('/')
    const carpeta = r.slice(0, corte)
    porCarpeta.set(carpeta, [...(porCarpeta.get(carpeta) ?? []), r.slice(corte + 1)])
  }
  const siguen: string[] = []
  for (const [carpeta, nombres] of porCarpeta) {
    const { data, error } = await service.storage
      .from(BUCKET_AULA_FOTOS)
      .list(carpeta, { limit: 1000 })
    if (error)
      throw new Error(`Storage ${BUCKET_AULA_FOTOS}: no se pudo comprobar: ${error.message}`)
    const hay = new Set((data ?? []).map((o) => o.name))
    for (const n of nombres) if (hay.has(n)) siguen.push(`${carpeta}/${n}`)
  }
  return siguen
}
