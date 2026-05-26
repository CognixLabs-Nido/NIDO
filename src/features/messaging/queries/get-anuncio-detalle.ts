import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { AnuncioDetalle } from '../types'

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
    // Lectores actuales
    const { count: leidos } = await supabase
      .from('lectura_anuncio')
      .select('*', { count: 'exact', head: true })
      .eq('anuncio_id', anuncioId)

    // Audiencia teórica:
    //   - ámbito='aula': tutores con permiso de niños matriculados activos + profes activos del aula.
    //   - ámbito='centro': tutores con permiso del centro + profes activos del centro.
    let total = 0
    if (anuncio.ambito === 'aula' && anuncio.aula_id) {
      const { data: tutores } = await supabase
        .from('vinculos_familiares')
        .select(
          'usuario_id, nino_id, matriculas:ninos!inner(matriculas!inner(aula_id, fecha_baja))'
        )
        .filter('permisos->puede_recibir_mensajes', 'eq', true)
        .is('deleted_at', null)
      // El filter anterior es approximate; lo confirmamos en JS por aula_id y fecha_baja.
      const tutoresAula = new Set<string>()
      for (const v of tutores ?? []) {
        const ms = v.matriculas?.matriculas ?? []
        for (const m of ms) {
          if (m.aula_id === anuncio.aula_id && m.fecha_baja === null) {
            tutoresAula.add(v.usuario_id)
            break
          }
        }
      }
      const { count: profesAula } = await supabase
        .from('profes_aulas')
        .select('*', { count: 'exact', head: true })
        .eq('aula_id', anuncio.aula_id)
        .is('fecha_fin', null)
        .is('deleted_at', null)
      total = tutoresAula.size + (profesAula ?? 0)
    } else if (anuncio.ambito === 'centro') {
      // Profes activos del centro
      const { data: aulasCentro } = await supabase
        .from('aulas')
        .select('id')
        .eq('centro_id', anuncio.centro_id)
        .is('deleted_at', null)
      const aulaIds = aulasCentro?.map((a) => a.id) ?? []
      let profes = 0
      if (aulaIds.length > 0) {
        const { count } = await supabase
          .from('profes_aulas')
          .select('*', { count: 'exact', head: true })
          .in('aula_id', aulaIds)
          .is('fecha_fin', null)
          .is('deleted_at', null)
        profes = count ?? 0
      }
      // Tutores con permiso de niños matriculados en aulas activas del centro
      const { data: tutores } = await supabase
        .from('vinculos_familiares')
        .select('usuario_id, ninos!inner(matriculas!inner(aula_id, fecha_baja))')
        .filter('permisos->puede_recibir_mensajes', 'eq', true)
        .is('deleted_at', null)
      const aulaSet = new Set(aulaIds)
      const tutoresCentro = new Set<string>()
      for (const v of tutores ?? []) {
        const ms = v.ninos?.matriculas ?? []
        for (const m of ms) {
          if (m.fecha_baja === null && aulaSet.has(m.aula_id)) {
            tutoresCentro.add(v.usuario_id)
            break
          }
        }
      }
      total = profes + tutoresCentro.size
    }

    detalle.lectores = {
      total,
      leidos: leidos ?? 0,
    }
  }

  return detalle
}
