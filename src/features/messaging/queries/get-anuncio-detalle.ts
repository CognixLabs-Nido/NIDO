import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { AnuncioDetalle } from '../types'

import { audienciaAnuncio } from './audiencia-anuncio'

/**
 * Detalle de un anuncio. RLS filtra: el usuario solo lo lee si es
 * audiencia (`usuario_es_audiencia_anuncio_row`).
 *
 * Si soy el autor, se carga adicionalmente el contador de lectores:
 *  - `leidos`: filas en `lectura_anuncio` para ese anuncio,
 *  - `total`: audiencia teórica calculada en tiempo de render contando
 *    profes activos + tutores con `puede_recibir_mensajes` del aula o
 *    centro según el ámbito.
 *
 * `total` es aproximado (refleja el estado en este momento). Si crece
 * la cardinalidad, se moverá a una vista o RPC dedicada.
 */
export async function getAnuncioDetalle(anuncioId: string): Promise<AnuncioDetalle | null> {
  const supabase = await createClient()

  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return null

  const { data: anuncio, error } = await supabase
    .from('anuncios')
    .select(
      `
      id,
      ambito,
      aula_id,
      centro_id,
      titulo,
      contenido,
      erroneo,
      created_at,
      autor_id,
      autor:usuarios!anuncios_autor_id_fkey (nombre_completo),
      aula:aulas (nombre)
      `
    )
    .eq('id', anuncioId)
    .maybeSingle()

  if (error) {
    logger.warn('getAnuncioDetalle', error.message)
    return null
  }
  if (!anuncio) return null

  const esPropio = anuncio.autor_id === userId

  const detalle: AnuncioDetalle = {
    id: anuncio.id,
    ambito: anuncio.ambito,
    aula_id: anuncio.aula_id,
    aula_nombre: anuncio.aula?.nombre ?? null,
    centro_id: anuncio.centro_id,
    titulo: anuncio.titulo,
    contenido: anuncio.contenido,
    erroneo: anuncio.erroneo,
    created_at: anuncio.created_at,
    autor_id: anuncio.autor_id,
    autor_nombre: anuncio.autor?.nombre_completo ?? '',
    es_propio: esPropio,
  }

  if (esPropio) {
    // Con la policy `lectura_anuncio_select_autor` (migración
    // `phase5_lectura_anuncio_autor_select_realtime`), el autor ahora ve
    // todas las filas de `lectura_anuncio` correspondientes a SUS anuncios.
    // Antes solo veía las suyas (0 si no se autoleyó), de ahí el bug
    // "0 de N" reportado en producción.
    const { count: leidos } = await supabase
      .from('lectura_anuncio')
      .select('*', { count: 'exact', head: true })
      .eq('anuncio_id', anuncioId)

    const audiencia = await audienciaAnuncio(supabase, {
      centro_id: anuncio.centro_id,
      ambito: anuncio.ambito,
      aula_id: anuncio.aula_id,
    })

    detalle.lectores = {
      total: audiencia.size,
      leidos: leidos ?? 0,
    }
  }

  return detalle
}
