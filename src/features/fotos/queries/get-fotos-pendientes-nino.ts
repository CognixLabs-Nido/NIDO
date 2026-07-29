import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

import { firmarRutas } from '../lib/storage'

export interface FotoPendiente {
  /** id de la etiqueta (foto×niño) — grano de "marcar resuelta". */
  etiquetaId: string
  mediaId: string
  publicacionId: string
  urlMiniatura: string | null
  /** nº de niños DISTINTOS etiquetados en toda la publicación (aviso antes de borrar). */
  ninosEnPublicacion: number
}

export interface FotosPendientesNino {
  nombre: string
  apellidos: string | null
  fotos: FotoPendiente[]
}

/**
 * IU-5 — fotos donde aparece un niño revocado, pendientes de resolver (Dirección).
 * Devuelve cada etiqueta sin resolver (`resuelta_en IS NULL`) con su miniatura firmada y
 * el nº de niños distintos etiquetados en su publicación (para avisar de que BORRAR la
 * publicación afecta a los demás). RLS: el admin ve las etiquetas/medias/publicaciones de
 * su centro. Devuelve `null` si el niño no existe / no visible.
 */
export async function getFotosPendientesNino(
  ninoId: string,
  centroId: string
): Promise<FotosPendientesNino | null> {
  const supabase = await createClient()

  const { data: nino } = await supabase
    .from('ninos')
    .select('nombre, apellidos')
    .eq('id', ninoId)
    .eq('centro_id', centroId)
    .maybeSingle()
  if (!nino) return null

  // Etiquetas pendientes del niño + su media (ruta miniatura + publicación).
  const { data: etiquetas } = await supabase
    .from('media_etiquetas')
    .select('id, media_id, media!inner(id, path_miniatura, publicacion_id)')
    .eq('nino_id', ninoId)
    .eq('centro_id', centroId)
    .is('resuelta_en', null)

  if (!etiquetas || etiquetas.length === 0) {
    return { nombre: nino.nombre, apellidos: nino.apellidos, fotos: [] }
  }

  type MediaRow = { id: string; path_miniatura: string | null; publicacion_id: string }
  const filas = etiquetas.map((e) => ({
    etiquetaId: e.id as string,
    mediaId: e.media_id as string,
    media: e.media as unknown as MediaRow,
  }))

  const pubIds = [...new Set(filas.map((f) => f.media.publicacion_id))]

  // Todas las medias de esas publicaciones (para mapear media→publicación).
  const { data: medias } = await supabase
    .from('media')
    .select('id, publicacion_id')
    .in('publicacion_id', pubIds)
  const pubDeMedia = new Map<string, string>()
  for (const m of medias ?? []) pubDeMedia.set(m.id, m.publicacion_id)

  // Niños distintos por publicación = unión de etiquetas sobre todas sus medias.
  const { data: todasEtiquetas } = await supabase
    .from('media_etiquetas')
    .select('media_id, nino_id')
    .in('media_id', [...pubDeMedia.keys()])
  const ninosPorPub = new Map<string, Set<string>>()
  for (const t of todasEtiquetas ?? []) {
    const pub = pubDeMedia.get(t.media_id)
    if (!pub) continue
    if (!ninosPorPub.has(pub)) ninosPorPub.set(pub, new Set())
    ninosPorPub.get(pub)!.add(t.nino_id)
  }

  // Firma de miniaturas con service role (ya autorizado como admin del centro).
  const rutas = filas
    .map((f) => f.media.path_miniatura)
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
  const service = createServiceRoleClient()
  const firmadas = rutas.length > 0 ? await firmarRutas(service, rutas) : new Map<string, string>()

  const fotos: FotoPendiente[] = filas.map((f) => ({
    etiquetaId: f.etiquetaId,
    mediaId: f.mediaId,
    publicacionId: f.media.publicacion_id,
    urlMiniatura: f.media.path_miniatura ? (firmadas.get(f.media.path_miniatura) ?? null) : null,
    ninosEnPublicacion: ninosPorPub.get(f.media.publicacion_id)?.size ?? 1,
  }))

  return { nombre: nino.nombre, apellidos: nino.apellidos, fotos }
}
