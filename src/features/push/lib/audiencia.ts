import 'server-only'

import { createServiceClient } from '@/lib/supabase/server'

/**
 * Devuelve los `usuario_id` que deben recibir un push tras un mensaje nuevo
 * en `conversacionId`. Equivale al cálculo de "puede participar en la
 * conversación" (profes activos del aula del niño + tutores con
 * `permisos.puede_recibir_mensajes = true`), excluyendo al propio autor.
 *
 * Usa **service role client** porque el autor (especialmente si es tutor)
 * normalmente no tiene RLS para leer todos los vínculos del niño ni los
 * `profes_aulas`. La auth del autor ya fue verificada por el server action
 * que invoca esta función; aquí solo computamos la lista de destinatarios.
 */
export async function destinatariosDeConversacion(
  conversacionId: string,
  excluyendoUserId: string
): Promise<string[]> {
  const supabase = await createServiceClient()

  // 1. Datos de la conversación.
  const { data: conv, error: convErr } = await supabase
    .from('conversaciones')
    .select('nino_id')
    .eq('id', conversacionId)
    .maybeSingle()

  if (convErr || !conv) {
    if (convErr) console.error('[destinatariosDeConversacion] conversaciones.select:', convErr)
    return []
  }
  // admin↔familia (`nino_id` NULL): el cálculo de destinatarios por
  // matrículas/vínculos del niño no aplica. F5.6-A no envía push para
  // este tipo de hilo aún — devolvemos lista vacía. Cuando se cablee,
  // los destinatarios serán {admin_id, tutor_id} \ excluyendoUserId.
  if (!conv.nino_id) return []

  const destinatarios = new Set<string>()

  // 2. Profes activos del aula actual del niño (vía matrículas activas).
  const { data: matriculas } = await supabase
    .from('matriculas')
    .select('aula_id')
    .eq('nino_id', conv.nino_id)
    .is('fecha_baja', null)
    .is('deleted_at', null)

  const aulaIds = (matriculas ?? []).map((m) => m.aula_id)
  if (aulaIds.length > 0) {
    const { data: profes } = await supabase
      .from('profes_aulas')
      .select('profe_id')
      .in('aula_id', aulaIds)
      .is('fecha_fin', null)
      .is('deleted_at', null)
    for (const p of profes ?? []) destinatarios.add(p.profe_id)
  }

  // 3. Tutores del niño con flag `puede_recibir_mensajes`. Filtramos en JS
  //    porque `permisos` es JSONB y el filtro `->` de PostgREST con `eq`
  //    no siempre acierta — más robusto cargar y comprobar.
  const { data: vinculos } = await supabase
    .from('vinculos_familiares')
    .select('usuario_id, permisos')
    .eq('nino_id', conv.nino_id)
    .is('deleted_at', null)

  for (const v of vinculos ?? []) {
    const permisos = (v.permisos as Record<string, boolean> | null) ?? {}
    if (permisos.puede_recibir_mensajes === true) {
      destinatarios.add(v.usuario_id)
    }
  }

  destinatarios.delete(excluyendoUserId)
  return Array.from(destinatarios)
}

/**
 * Devuelve los `usuario_id` (TUTORES) que deben recibir un push tras la
 * publicación de un anuncio. **No incluye profes ni admin** — ellos verán
 * el anuncio in-app y actúan como puente humano para los tutores excluidos
 * del canal digital (decisión F5, mantenida en F5.5).
 *
 *  - Ámbito `aula`: tutores con flag activos vinculados a niños matriculados
 *    activos en esa aula.
 *  - Ámbito `centro`: tutores con flag activos vinculados a niños
 *    matriculados activos en cualquier aula del centro.
 */
export async function destinatariosPushDeAnuncio(
  anuncio: {
    centro_id: string
    ambito: 'aula' | 'centro'
    aula_id: string | null
  },
  excluyendoUserId: string
): Promise<string[]> {
  const supabase = await createServiceClient()
  const destinatarios = new Set<string>()

  let aulasObjetivo: string[] = []
  if (anuncio.ambito === 'aula' && anuncio.aula_id) {
    aulasObjetivo = [anuncio.aula_id]
  } else if (anuncio.ambito === 'centro') {
    const { data: aulas } = await supabase
      .from('aulas')
      .select('id')
      .eq('centro_id', anuncio.centro_id)
      .is('deleted_at', null)
    aulasObjetivo = (aulas ?? []).map((a) => a.id)
  }

  if (aulasObjetivo.length === 0) return []

  // Tutores con flag, vinculados a niños matriculados activos en alguna de
  // las aulas objetivo. Cargamos el grafo y filtramos en JS para evitar
  // ambigüedad con filtros JSONB en PostgREST.
  const { data: tutores } = await supabase
    .from('vinculos_familiares')
    .select('usuario_id, permisos, nino:ninos!inner(matriculas(aula_id, fecha_baja, deleted_at))')
    .is('deleted_at', null)

  const aulaSet = new Set(aulasObjetivo)
  for (const v of tutores ?? []) {
    const permisos = (v.permisos as Record<string, boolean> | null) ?? {}
    if (permisos.puede_recibir_mensajes !== true) continue
    const matriculas = v.nino?.matriculas ?? []
    const enAulaActiva = matriculas.some(
      (m) => m.fecha_baja === null && m.deleted_at === null && aulaSet.has(m.aula_id)
    )
    if (enAulaActiva) destinatarios.add(v.usuario_id)
  }

  destinatarios.delete(excluyendoUserId)
  return Array.from(destinatarios)
}

/**
 * Recupera el `idioma_preferido` y `nombre_completo` del autor para
 * construir el payload de push. Usa service role para evitar problemas
 * de RLS de `usuarios` cuando el autor es un tutor consultando su propio
 * registro — la RLS lo permite, pero unificamos la convención.
 */
export async function getAutorPushInfo(
  userId: string
): Promise<{ nombre: string; idioma: string }> {
  const supabase = await createServiceClient()
  const { data } = await supabase
    .from('usuarios')
    .select('nombre_completo, idioma_preferido')
    .eq('id', userId)
    .maybeSingle()
  return {
    nombre: data?.nombre_completo ?? 'NIDO',
    idioma: data?.idioma_preferido ?? 'es',
  }
}
