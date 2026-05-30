import 'server-only'

import { createServiceClient } from '@/lib/supabase/server'

/**
 * Devuelve los `usuario_id` que deben recibir un push tras un mensaje nuevo
 * en la conversación profe↔familia del niño `ninoId`. Equivale al cálculo
 * de "puede participar en la conversación" (profes activos del aula del
 * niño + tutores con `permisos.puede_recibir_mensajes = true`), excluyendo
 * al propio autor.
 *
 * Usa **service role client** porque el autor (especialmente si es tutor)
 * normalmente no tiene RLS para leer todos los vínculos del niño ni los
 * `profes_aulas`. La auth del autor ya fue verificada por el server action
 * que invoca esta función; aquí solo computamos la lista de destinatarios.
 *
 * Solo aplica a conversaciones `profe_familia`. Para `admin_familia` el
 * caller no debe invocar este helper — el cálculo de destinatarios del par
 * (admin, tutor) entrará con F5.6-D cuando se cablee el push de admin↔familia.
 */
export async function destinatariosDeNino(
  ninoId: string,
  excluyendoUserId: string
): Promise<string[]> {
  const supabase = await createServiceClient()

  // Profes (vía matriculas → profes_aulas) y vínculos familiares son
  // independientes entre sí: lanzamos ambas queries en paralelo. `profes_aulas`
  // sí depende de los `aula_id` que devuelve `matriculas`, así que va después.
  const [matriculasRes, vinculosRes] = await Promise.all([
    supabase
      .from('matriculas')
      .select('aula_id')
      .eq('nino_id', ninoId)
      .is('fecha_baja', null)
      .is('deleted_at', null),
    supabase
      .from('vinculos_familiares')
      .select('usuario_id, permisos')
      .eq('nino_id', ninoId)
      .is('deleted_at', null),
  ])

  const destinatarios = new Set<string>()

  const aulaIds = (matriculasRes.data ?? []).map((m) => m.aula_id)
  if (aulaIds.length > 0) {
    const { data: profes } = await supabase
      .from('profes_aulas')
      .select('profe_id')
      .in('aula_id', aulaIds)
      .is('fecha_fin', null)
      .is('deleted_at', null)
    for (const p of profes ?? []) destinatarios.add(p.profe_id)
  }

  // Tutores con flag `puede_recibir_mensajes`. Filtramos en JS porque
  // `permisos` es JSONB y el filtro `->` de PostgREST con `eq` no siempre
  // acierta — más robusto cargar y comprobar.
  for (const v of vinculosRes.data ?? []) {
    const permisos = (v.permisos as Record<string, boolean> | null) ?? {}
    if (permisos.puede_recibir_mensajes === true) {
      destinatarios.add(v.usuario_id)
    }
  }

  destinatarios.delete(excluyendoUserId)
  return Array.from(destinatarios)
}

/**
 * Destinatarios push de un mensaje nuevo en una conversación admin↔familia
 * (F5.6). Una conversación `admin_familia` es un par 1-a-1 (`admin_id`,
 * `tutor_id`) **sin niño asociado** (`nino_id` NULL). El destinatario de un
 * mensaje es el OTRO miembro del par — el que no lo escribió. Como mucho 1.
 *
 * Push **INCONDICIONAL** (no se gatea por `puede_recibir_mensajes`):
 *  - la RLS (`puede_participar_conversacion`) ya deja participar al tutor en
 *    `admin_familia` sin mirar el flag, así que el mensaje le llega in-app
 *    igual; el push debe ser coherente con eso;
 *  - el flag vive en `vinculos_familiares.permisos` por (niño, tutor) y aquí
 *    NO hay niño → estaría mal definido;
 *  - el admin contacta asuntos administrativos generales, no per-niño.
 *
 * Es **puro** (sin I/O): el caller ya tiene `admin_id`/`tutor_id` desde la
 * fila de la conversación. A diferencia de `destinatariosDeNino`, no necesita
 * service role ni queries.
 */
export function destinatariosDeAdminFamilia(
  adminId: string,
  tutorId: string,
  excluyendoUserId: string
): string[] {
  return [adminId, tutorId].filter((id) => id !== excluyendoUserId)
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
