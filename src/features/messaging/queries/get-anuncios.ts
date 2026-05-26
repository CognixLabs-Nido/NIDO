import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { AnuncioListItem } from '../types'

/**
 * Devuelve los anuncios que el usuario puede leer (RLS filtra vía
 * `usuario_es_audiencia_anuncio_row`):
 *  - admin del centro: todos los del centro,
 *  - profe del aula: ámbito='aula' de su aula + ámbito='centro' del centro,
 *  - tutor con `puede_recibir_mensajes`: anuncios cuyo aula tiene matrícula
 *    activa de su niño + ámbito='centro' del centro.
 *
 * `puede_recibir_mensajes=false` ⇒ lista vacía (flag global, F5 scope).
 */
export async function getAnunciosDelUsuario(): Promise<AnuncioListItem[]> {
  const supabase = await createClient()

  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return []

  const { data: anuncios, error } = await supabase
    .from('anuncios')
    .select(
      `
      id,
      ambito,
      aula_id,
      titulo,
      contenido,
      autor_id,
      erroneo,
      created_at,
      autor:usuarios!anuncios_autor_id_fkey (
        nombre_completo
      ),
      aula:aulas (
        nombre
      )
      `
    )
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    logger.warn('getAnunciosDelUsuario', error.message)
    return []
  }

  if (!anuncios || anuncios.length === 0) return []

  const anuncioIds = anuncios.map((a) => a.id)

  // Lecturas del usuario (existe fila → leído).
  const { data: lecturas } = await supabase
    .from('lectura_anuncio')
    .select('anuncio_id')
    .eq('usuario_id', userId)
    .in('anuncio_id', anuncioIds)

  const leidoSet = new Set(lecturas?.map((l) => l.anuncio_id) ?? [])

  return anuncios.map((a) => ({
    id: a.id,
    ambito: a.ambito,
    aula_id: a.aula_id,
    aula_nombre: a.aula?.nombre ?? null,
    titulo: a.titulo,
    contenido: a.contenido,
    autor_id: a.autor_id,
    autor_nombre: a.autor?.nombre_completo ?? '',
    erroneo: a.erroneo,
    created_at: a.created_at,
    leido: leidoSet.has(a.id),
    es_propio: a.autor_id === userId,
  }))
}
