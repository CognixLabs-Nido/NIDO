import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import { BUCKET_NINOS_FOTOS, rutaThumbDe } from '@/shared/lib/adjuntos/storage'

import { BUCKET_AULA_FOTOS } from '@/features/fotos/types'

import type { SujetoOlvido } from '../types'

type Service = SupabaseClient<Database>

/**
 * Manifiesto DECLARATIVO de fuentes de adjuntos para el barrido del olvido
 * (Decisión C). Cada entrada sabe, para un sujeto, qué rutas de Storage hay que
 * borrar y de qué bucket. El barrido itera el manifiesto sin conocer cada feature.
 *
 * EXTENSIBILIDAD: el futuro anexo de vacunas (datos médicos) se añade como una
 * entrada más `{ bucket, sujetos, recolectar }` — el barrido NO se reescribe.
 *
 * Las firmas (`recogida-adjuntos`, DNIs de terceros) NO entran (#7): son prueba
 * con retención legal; sus adjuntos los purga A6 por tiempo, no el olvido.
 */
export interface FuenteAdjunto {
  /** Identificador legible (logs/tests). */
  nombre: string
  /** Bucket de Storage donde viven los objetos. */
  bucket: string
  /** Tipos de sujeto a los que aplica. */
  sujetos: readonly SujetoOlvido[]
  /** Devuelve las rutas a borrar para ese sujeto (vacío si no hay). */
  recolectar(service: Service, sujetoId: string): Promise<string[]>
}

export const FUENTES_ADJUNTOS: readonly FuenteAdjunto[] = [
  {
    nombre: 'foto-perfil-nino',
    bucket: BUCKET_NINOS_FOTOS,
    sujetos: ['nino'],
    async recolectar(service, ninoId) {
      const { data } = await service.from('ninos').select('foto_url').eq('id', ninoId).maybeSingle()
      const url = data?.foto_url
      return url ? [url, rutaThumbDe(url)] : []
    },
  },
  {
    nombre: 'blog-fotos-exclusivas-nino',
    bucket: BUCKET_AULA_FOTOS,
    sujetos: ['nino'],
    async recolectar(service, ninoId) {
      // #5: solo se borra el objeto si el niño era el ÚNICO etiquetado. En fotos
      // compartidas se conserva la foto (dato de terceros); la migración quita solo
      // la etiqueta.
      const { data: etis } = await service
        .from('media_etiquetas')
        .select('media_id')
        .eq('nino_id', ninoId)
      const mediaIds = [...new Set((etis ?? []).map((e) => e.media_id))]
      if (mediaIds.length === 0) return []

      const { data: todas } = await service
        .from('media_etiquetas')
        .select('media_id, nino_id')
        .in('media_id', mediaIds)
      const exclusivos = mediaIds.filter((mid) =>
        (todas ?? []).filter((t) => t.media_id === mid).every((t) => t.nino_id === ninoId)
      )
      if (exclusivos.length === 0) return []

      const { data: media } = await service
        .from('media')
        .select('path, path_miniatura')
        .in('id', exclusivos)
      return (media ?? []).flatMap((m) =>
        [m.path, m.path_miniatura].filter((p): p is string => Boolean(p))
      )
    },
  },
]

/**
 * Recorre el manifiesto y agrupa por bucket las rutas a borrar para un sujeto.
 * Se invoca ANTES de la purga SQL (que anula `foto_url` / borra filas `media`),
 * de modo que las rutas siguen siendo resolubles.
 */
export async function recolectarAdjuntosDe(
  service: Service,
  sujetoTipo: SujetoOlvido,
  sujetoId: string
): Promise<Map<string, string[]>> {
  const porBucket = new Map<string, string[]>()
  for (const fuente of FUENTES_ADJUNTOS) {
    if (!fuente.sujetos.includes(sujetoTipo)) continue
    const paths = await fuente.recolectar(service, sujetoId)
    if (paths.length === 0) continue
    porBucket.set(fuente.bucket, [...(porBucket.get(fuente.bucket) ?? []), ...paths])
  }
  return porBucket
}
