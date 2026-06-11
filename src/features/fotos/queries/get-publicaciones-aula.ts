import 'server-only'

import { createClient, createServiceClient } from '@/lib/supabase/server'

import { getRolEnCentro } from '@/features/centros/queries/get-centro-actual'

import { firmarRutas } from '../lib/storage'
import type { MediaItem, PublicacionItem } from '../types'

/** Tope de publicaciones por carga (paginación simple del blog — Performance spec). */
const LIMITE_PUBLICACIONES = 20

interface PublicacionRow {
  id: string
  texto: string | null
  autor_id: string
  created_at: string
  updated_at: string
  autor: { nombre_completo: string | null } | null
}

interface MediaRow {
  id: string
  publicacion_id: string
  path: string
  path_miniatura: string | null
  ancho: number | null
  alto: number | null
}

/**
 * Publicaciones del blog de un aula para la vista de **staff** (F10-1), con sus
 * fotos (enlaces firmados ~1 h: miniatura para la rejilla + original a demanda) y
 * las etiquetas de niños. La RLS de `publicaciones`/`media`/`media_etiquetas`
 * decide qué se ve; las URLs se firman con service role tras esa autorización
 * (ADR-0027). `puedeGestionar` = autor o admin del centro (P-borrado/P-edición).
 */
export async function getPublicacionesAula(
  aulaId: string,
  centroId: string
): Promise<PublicacionItem[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const rol = await getRolEnCentro(centroId)
  const esAdmin = rol === 'admin'

  const { data: pubs } = await supabase
    .from('publicaciones')
    .select('id, texto, autor_id, created_at, updated_at, autor:usuarios!inner(nombre_completo)')
    .eq('aula_id', aulaId)
    .order('created_at', { ascending: false })
    .limit(LIMITE_PUBLICACIONES)

  const publicaciones = (pubs ?? []) as unknown as PublicacionRow[]
  if (publicaciones.length === 0) return []

  const pubIds = publicaciones.map((p) => p.id)

  const { data: mediaData } = await supabase
    .from('media')
    .select('id, publicacion_id, path, path_miniatura, ancho, alto')
    .in('publicacion_id', pubIds)
    .order('created_at', { ascending: true })

  const medias = (mediaData ?? []) as MediaRow[]
  const mediaIds = medias.map((m) => m.id)

  const { data: etiquetaData } = mediaIds.length
    ? await supabase.from('media_etiquetas').select('media_id, nino_id').in('media_id', mediaIds)
    : { data: [] }

  // Firma todas las rutas (original + miniatura) en un lote (evita N+1).
  const service = await createServiceClient()
  const rutas = medias.flatMap((m) => [m.path, m.path_miniatura].filter((p): p is string => !!p))
  const firmadas = await firmarRutas(service, rutas)

  // Etiquetas por media (acotadas a las medias visibles).
  const etiquetasPorMedia = new Map<string, string[]>()
  for (const e of (etiquetaData ?? []) as { media_id: string; nino_id: string }[]) {
    const lista = etiquetasPorMedia.get(e.media_id) ?? []
    lista.push(e.nino_id)
    etiquetasPorMedia.set(e.media_id, lista)
  }

  const mediaPorPub = new Map<string, MediaItem[]>()
  for (const m of medias) {
    const item: MediaItem = {
      id: m.id,
      ancho: m.ancho,
      alto: m.alto,
      url: firmadas.get(m.path) ?? null,
      urlMiniatura: m.path_miniatura ? (firmadas.get(m.path_miniatura) ?? null) : null,
      etiquetas: etiquetasPorMedia.get(m.id) ?? [],
    }
    const lista = mediaPorPub.get(m.publicacion_id) ?? []
    lista.push(item)
    mediaPorPub.set(m.publicacion_id, lista)
  }

  return publicaciones.map((p) => ({
    id: p.id,
    texto: p.texto,
    autorId: p.autor_id,
    autorNombre: p.autor?.nombre_completo ?? null,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    puedeGestionar: esAdmin || p.autor_id === user.id,
    media: mediaPorPub.get(p.id) ?? [],
  }))
}
