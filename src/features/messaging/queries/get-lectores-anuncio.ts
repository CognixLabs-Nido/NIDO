import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { audienciaAnuncio } from './audiencia-anuncio'

export interface LectorAnuncioItem {
  usuario_id: string
  nombre_completo: string
  /** ISO timestamp si el usuario ha marcado el anuncio como leído; null en caso contrario. */
  leido_en: string | null
}

/**
 * Lista de destinatarios del anuncio + timestamp de lectura (o null si no
 * lo han leído todavía). Solo el autor del anuncio puede invocar esto con
 * éxito porque:
 *
 *  - La RLS de `anuncios.SELECT` filtra: si el usuario no es autor ni
 *    audiencia del anuncio, el SELECT inicial devuelve null y la query
 *    aborta devolviendo `[]`.
 *  - La RLS de `lectura_anuncio.SELECT` se ampliada en
 *    `phase5_lectura_anuncio_autor_select_realtime` para que el autor lea
 *    todas las filas correspondientes a sus anuncios. Cualquier otro
 *    usuario sigue limitado a sus propias lecturas (`select_self`), así
 *    que invocar esto desde un destinatario solo devolverá su propia
 *    fila — la UI solo expone el botón al autor.
 *
 * La audiencia se calcula con el mismo helper que `getAnuncioDetalle`
 * para que "X de Y" del contador y "X marcados" del modal sean
 * coherentes en el mismo render.
 */
export async function getLectoresAnuncio(anuncioId: string): Promise<LectorAnuncioItem[]> {
  const supabase = await createClient()

  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return []

  const { data: anuncio, error: anErr } = await supabase
    .from('anuncios')
    .select('id, centro_id, ambito, aula_id, autor_id')
    .eq('id', anuncioId)
    .maybeSingle()

  if (anErr) {
    logger.warn('getLectoresAnuncio: anuncio', anErr.message)
    return []
  }
  if (!anuncio) return []
  if (anuncio.autor_id !== userId) {
    // Defensivo: solo el autor puede ver el desglose. RLS también lo
    // protege para las queries de `lectura_anuncio`, pero salimos antes
    // para evitar trabajo inútil.
    return []
  }

  const audiencia = await audienciaAnuncio(supabase, {
    centro_id: anuncio.centro_id,
    ambito: anuncio.ambito,
    aula_id: anuncio.aula_id,
  })
  if (audiencia.size === 0) return []

  const audienciaIds = Array.from(audiencia)

  const [{ data: usuarios, error: usuariosErr }, { data: lecturas, error: lecturasErr }] =
    await Promise.all([
      supabase.from('usuarios').select('id, nombre_completo').in('id', audienciaIds),
      supabase.from('lectura_anuncio').select('usuario_id, leido_at').eq('anuncio_id', anuncioId),
    ])

  if (usuariosErr) {
    logger.warn('getLectoresAnuncio: usuarios', usuariosErr.message)
    return []
  }
  if (lecturasErr) {
    logger.warn('getLectoresAnuncio: lecturas', lecturasErr.message)
  }

  const leidoByUser = new Map<string, string>()
  for (const l of lecturas ?? []) leidoByUser.set(l.usuario_id, l.leido_at)

  return (usuarios ?? [])
    .map((u) => ({
      usuario_id: u.id,
      nombre_completo: u.nombre_completo,
      leido_en: leidoByUser.get(u.id) ?? null,
    }))
    .sort((a, b) => {
      // Primero los que han leído (más recientes arriba), luego los que no.
      if (a.leido_en && b.leido_en) return b.leido_en.localeCompare(a.leido_en)
      if (a.leido_en) return -1
      if (b.leido_en) return 1
      return a.nombre_completo.localeCompare(b.nombre_completo)
    })
}
