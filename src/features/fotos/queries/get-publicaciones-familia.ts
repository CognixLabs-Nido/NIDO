import 'server-only'

import { createClient, createServiceClient } from '@/lib/supabase/server'

import { firmarRutas } from '../lib/storage'
import type { MediaFamiliaItem, PublicacionFamiliaItem } from '../types'

/** Tope de publicaciones por carga (paginación simple del blog — Performance spec). */
const LIMITE_PUBLICACIONES = 20

interface PublicacionRow {
  id: string
  texto: string | null
  created_at: string
  autor_id: string
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
 * Publicaciones del blog visibles para la **familia** (F10-2), solo lectura. La
 * **RLS** (`publicaciones_select` → `usuario_ve_publicacion_row`) ya decide qué se ve:
 *  - el blog del aula donde el hijo tiene **matrícula activa** + `puede_ver_fotos` (P2), y
 *  - las publicaciones pasadas donde un hijo está **etiquetado** aunque ya no tenga
 *    matrícula (P-histórico, vía la migración F10-2 `publicacion_etiqueta_hijo_de`).
 *
 * No filtramos por aula: la RLS unifica aula-actual + histórico. Las URLs se firman con
 * service role tras esa autorización (ADR-0027). **No** se traen etiquetas: la familia
 * solo ve las fotos, no quién está etiquetado (privacidad de otros niños).
 */
export async function getPublicacionesFamilia(): Promise<PublicacionFamiliaItem[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  // Sin join a `usuarios` (la RLS solo deja leer la fila propia/admin → un `!inner`
  // descartaría las publicaciones de la familia). El nombre del autor se resuelve con
  // service role abajo (patrón F9 `get-informe-pdf-data`).
  const { data: pubs } = await supabase
    .from('publicaciones')
    .select('id, texto, created_at, autor_id')
    .order('created_at', { ascending: false })
    .limit(LIMITE_PUBLICACIONES)

  const publicaciones = (pubs ?? []) as PublicacionRow[]
  if (publicaciones.length === 0) return []

  const pubIds = publicaciones.map((p) => p.id)

  const { data: mediaData } = await supabase
    .from('media')
    .select('id, publicacion_id, path, path_miniatura, ancho, alto')
    .in('publicacion_id', pubIds)
    .order('created_at', { ascending: true })

  const medias = (mediaData ?? []) as MediaRow[]

  // Firma todas las rutas (original + miniatura) en un lote (evita N+1) y resuelve los
  // nombres de autor con service role (la familia no puede leer `usuarios` por RLS).
  const service = await createServiceClient()
  const rutas = medias.flatMap((m) => [m.path, m.path_miniatura].filter((p): p is string => !!p))
  const autorIds = [...new Set(publicaciones.map((p) => p.autor_id))]
  const [firmadas, autoresRes] = await Promise.all([
    firmarRutas(service, rutas),
    service.from('usuarios').select('id, nombre_completo').in('id', autorIds),
  ])
  const nombrePorAutor = new Map(
    (autoresRes.data ?? []).map((u) => [u.id, u.nombre_completo as string | null])
  )

  const mediaPorPub = new Map<string, MediaFamiliaItem[]>()
  for (const m of medias) {
    const item: MediaFamiliaItem = {
      id: m.id,
      ancho: m.ancho,
      alto: m.alto,
      url: firmadas.get(m.path) ?? null,
      urlMiniatura: m.path_miniatura ? (firmadas.get(m.path_miniatura) ?? null) : null,
    }
    const lista = mediaPorPub.get(m.publicacion_id) ?? []
    lista.push(item)
    mediaPorPub.set(m.publicacion_id, lista)
  }

  return publicaciones.map((p) => ({
    id: p.id,
    texto: p.texto,
    autorNombre: nombrePorAutor.get(p.autor_id) ?? null,
    createdAt: p.created_at,
    media: mediaPorPub.get(p.id) ?? [],
  }))
}
