import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  aplicarMatriculaActiva,
  esMatriculaActiva,
} from '@/features/matriculas/lib/matricula-activa'

import { esIdioma, IDIOMA_POR_DEFECTO, type Idioma } from './idioma'
import { LecturaFallida } from '@/shared/lib/lectura-fallida'
import { lecturaFallidaTrasEscritura } from '@/shared/lib/tras-escritura'

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
  const supabase = createServiceRoleClient()

  // Profes (vía matriculas → profes_aulas) y vínculos familiares son
  // independientes entre sí: lanzamos ambas queries en paralelo.
  const [profes, vinculosRes] = await Promise.all([
    profesDelAulaDelNino(ninoId),
    supabase
      .from('vinculos_familiares')
      .select('usuario_id, permisos')
      .eq('nino_id', ninoId)
      .is('deleted_at', null),
  ])
  if (vinculosRes.error) throw new LecturaFallida('destinatariosDeNino', vinculosRes.error)

  const destinatarios = new Set<string>(profes)

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
 * Las profes del aula del niño: las que tienen una asignación viva (`profes_aulas`, sin
 * `fecha_fin`) en el aula de su matrícula activa. Con el cliente de servicio: quien avisa
 * (normalmente un tutor) no lee `profes_aulas`. La usan los mensajes y el aviso de una recogida
 * firmada. Un fallo de lectura sale como lista vacía: el push es best-effort (degradación deliberada; el
 * mensaje ya está guardado). Desde el censo C (2026-11-26) el fallo va a Sentry, no a la nada.
 */
export async function profesDelAulaDelNino(ninoId: string): Promise<string[]> {
  const supabase = createServiceRoleClient()
  // `profes_aulas` depende de los `aula_id` que devuelve `matriculas`, así que va después.
  const matriculasRes = await aplicarMatriculaActiva(
    supabase.from('matriculas').select('aula_id').eq('nino_id', ninoId)
  )
  if (matriculasRes.error) {
    lecturaFallidaTrasEscritura('push: aula del niño', matriculasRes.error)
    return []
  }
  const aulaIds = (matriculasRes.data ?? []).map((m) => m.aula_id)
  if (aulaIds.length === 0) return []
  const { data: profes, error: errProfes } = await supabase
    .from('profes_aulas')
    .select('profe_id')
    .in('aula_id', aulaIds)
    .is('fecha_fin', null)
    .is('deleted_at', null)
  if (errProfes) {
    lecturaFallidaTrasEscritura('push: profes del aula', errProfes)
    return []
  }
  return [...new Set((profes ?? []).map((p) => p.profe_id))]
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
  const supabase = createServiceRoleClient()
  const destinatarios = new Set<string>()

  let aulasObjetivo: string[] = []
  if (anuncio.ambito === 'aula' && anuncio.aula_id) {
    // R3 (multi-centro): el aula tiene que ser del centro del anuncio. Si no lo es, nadie
    // recibe el push (las familias de un aula de OTRO centro nunca).
    const { data: aula, error } = await supabase
      .from('aulas')
      .select('id')
      .eq('id', anuncio.aula_id)
      .eq('centro_id', anuncio.centro_id)
      .maybeSingle()
    if (error) throw new LecturaFallida('destinatariosPushDeAnuncio', error)
    aulasObjetivo = aula ? [aula.id] : []
  } else if (anuncio.ambito === 'centro') {
    const { data: aulas, error: errorLectura } = await supabase
      .from('aulas')
      .select('id')
      .eq('centro_id', anuncio.centro_id)
      .is('deleted_at', null)
    if (errorLectura) throw new LecturaFallida('destinatariosPushDeAnuncio', errorLectura)
    aulasObjetivo = (aulas ?? []).map((a) => a.id)
  }

  if (aulasObjetivo.length === 0) return []

  // Tutores con flag, vinculados a niños matriculados activos en alguna de
  // las aulas objetivo. Cargamos el grafo de los niños del centro (service role: sin el filtro
  // traería los de toda la plataforma) y filtramos en JS para evitar ambigüedad con filtros
  // JSONB en PostgREST.
  const { data: tutores, error: errorLectura2 } = await supabase
    .from('vinculos_familiares')
    .select(
      'usuario_id, permisos, nino:ninos!inner(matriculas(aula_id, fecha_baja, deleted_at, estado))'
    )
    .eq('nino.centro_id', anuncio.centro_id)
    .is('deleted_at', null)
  if (errorLectura2) throw new LecturaFallida('destinatariosPushDeAnuncio', errorLectura2)

  const aulaSet = new Set(aulasObjetivo)
  for (const v of tutores ?? []) {
    const permisos = (v.permisos as Record<string, boolean> | null) ?? {}
    if (permisos.puede_recibir_mensajes !== true) continue
    const matriculas = v.nino?.matriculas ?? []
    const enAulaActiva = matriculas.some((m) => esMatriculaActiva(m) && aulaSet.has(m.aula_id))
    if (enAulaActiva) destinatarios.add(v.usuario_id)
  }

  destinatarios.delete(excluyendoUserId)
  return Array.from(destinatarios)
}

/**
 * Recupera el `nombre_completo` del autor para el título del push. Usa service role para evitar
 * problemas de RLS de `usuarios` cuando el autor es un tutor consultando su propio registro — la
 * RLS lo permite, pero unificamos la convención.
 *
 * No devuelve su idioma, a propósito: la notificación va en el idioma de QUIEN LA RECIBE
 * (`enviarPushPorIdioma`). Antes lo devolvía y los enlaces y textos salían en el del autor.
 */
export async function getAutorPushInfo(userId: string): Promise<{ nombre: string }> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('usuarios')
    .select('nombre_completo')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw new LecturaFallida('getAutorPushInfo', error)
  return { nombre: data?.nombre_completo ?? 'NIDO' }
}

/**
 * El idioma de cada destinatario (`usuarios.idioma_preferido`), para mandar la notificación en
 * el suyo. Service role: el autor no lee el perfil de los demás. Quien no aparezca (o con un
 * valor fuera de los idiomas de la app) recibe el idioma por defecto.
 */
export async function idiomasDeUsuarios(usuarioIds: string[]): Promise<Map<string, Idioma>> {
  const idiomas = new Map<string, Idioma>()
  if (usuarioIds.length === 0) return idiomas
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('usuarios')
    .select('id, idioma_preferido')
    .in('id', usuarioIds)
  // Degradación deliberada: sin leerlos, cada uno recibe el idioma por defecto. A Sentry (censo C).
  if (error) lecturaFallidaTrasEscritura('push: idiomas de los destinatarios', error)
  for (const u of data ?? [])
    idiomas.set(u.id, esIdioma(u.idioma_preferido) ? u.idioma_preferido : IDIOMA_POR_DEFECTO)
  return idiomas
}
