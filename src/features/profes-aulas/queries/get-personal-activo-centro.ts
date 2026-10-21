import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { llamarGoTrue } from '@/features/auth/lib/llamar-gotrue'
import { personalDelCentro, type MiembroPersonal } from '@/features/centros/contexto/roles-de-otros'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { TIPO_PERSONAL_AULA_ORDER, type TipoPersonalAula } from '@/features/profes-aulas/types'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

/**
 * Personal ACTIVO del centro para `/admin/personal` (Fallo 1 — el listado de
 * profes ya dados de alta nunca estuvo en esta página; F11-C-1 solo añadió las
 * invitaciones pendientes). Devuelve **una fila por persona**: si la profe está
 * en varias aulas, sus pares (rol · aula) se agrupan en `asignaciones` — sin
 * duplicar foto/nombre/email.
 *
 * Desde la baja del personal, esto da solo las AULAS de cada persona: quién es personal del centro
 * lo dice su rol (`getPersonalDelCentro`, abajo), también quien no tiene aula.
 *
 * El email vive en `auth.users` (no en `public.usuarios`) → se lee por
 * service-role. La autorización es la del layout `/admin` (solo admin del
 * centro accede a la página). Los demás campos (aulas, profes_aulas, usuarios)
 * pasan por la RLS del cliente del admin (`profes_aulas_admin_all`).
 */
export interface AsignacionPersonal {
  aula_id: string
  aula_nombre: string
  tipo_personal_aula: TipoPersonalAula
}

export interface PersonalActivoItem {
  profe_id: string
  nombre_completo: string
  email: string | null
  /** Ruta en el bucket `usuarios-fotos` (SIN firmar); null si no hay avatar. */
  foto_url: string | null
  /** Una entrada por (aula, tipo); varias si la persona está en varias aulas. */
  asignaciones: AsignacionPersonal[]
}

/** Resuelve email por id de usuario (auth.users). Inyectable para test. */
export type EmailResolver = (profeIds: string[]) => Promise<Map<string, string>>

interface ProfeRow {
  aula_id: string
  tipo_personal_aula: TipoPersonalAula
  profe: { id: string; nombre_completo: string; foto_url: string | null } | null
}

interface AulaCursoNombreRow {
  aula_id: string
  aula: { nombre: string; deleted_at: string | null } | null
}

/**
 * Email de cada id en `auth.users`, con una lectura EXACTA por id (`getUserById`). Antes era
 * `listUsers({ page: 1, perPage: 1000 })`: con más de 1000 cuentas en `auth.users`, el
 * personal que cayera fuera de la 1.ª página salía sin email. Una llamada por persona del
 * centro (decenas), en paralelo. Un id sin cuenta o una llamada fallida deja esa persona sin
 * email, como antes; nunca rompe el listado.
 */
export async function resolverEmailsPorId(
  service: Pick<SupabaseClient<Database>, 'auth'>,
  ids: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const resultados = await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const { data, error } = await llamarGoTrue('getUserById', () =>
        service.auth.admin.getUserById(id)
      )
      if (error) logger.warn('resolverEmailsPorId getUserById', error.message)
      return { id, email: data?.user?.email ?? null }
    })
  )
  for (const r of resultados) if (r.email) map.set(r.id, r.email)
  return map
}

/** Núcleo testeable: cliente Supabase + curso + resolutor de emails inyectables. */
export async function getPersonalActivoCentroCore(
  supabase: SupabaseClient<Database>,
  cursoAcademicoId: string,
  emailResolver: EmailResolver
): Promise<PersonalActivoItem[]> {
  // F11-H: las aulas del curso (id + nombre físico) salen de aulas_curso → aulas.
  const { data: aulasCurso, error: aulasErr } = await supabase
    .from('aulas_curso')
    .select('aula_id, aula:aulas!inner(nombre, deleted_at)')
    .eq('curso_academico_id', cursoAcademicoId)

  if (aulasErr) {
    logger.warn('getPersonalActivoCentro: aulas', aulasErr.message)
    return []
  }
  const aulasList = ((aulasCurso ?? []) as unknown as AulaCursoNombreRow[])
    .filter((r) => r.aula && r.aula.deleted_at === null)
    .map((r) => ({ id: r.aula_id, nombre: r.aula!.nombre }))
  if (aulasList.length === 0) return []
  const aulaNombre = new Map(aulasList.map((a) => [a.id, a.nombre]))
  const aulaIds = aulasList.map((a) => a.id)

  const { data: profes, error: profesErr } = await supabase
    .from('profes_aulas')
    .select('aula_id, tipo_personal_aula, profe:usuarios!inner(id, nombre_completo, foto_url)')
    .eq('curso_academico_id', cursoAcademicoId)
    .in('aula_id', aulaIds)
    .is('fecha_fin', null)
    .is('deleted_at', null)

  if (profesErr) {
    logger.warn('getPersonalActivoCentro: profes_aulas', profesErr.message)
    return []
  }

  // Agrupar por profe_id → una fila por persona, varias asignaciones posibles.
  const porProfe = new Map<string, PersonalActivoItem>()
  for (const p of (profes ?? []) as unknown as ProfeRow[]) {
    if (!p.profe) continue
    const item =
      porProfe.get(p.profe.id) ??
      ({
        profe_id: p.profe.id,
        nombre_completo: p.profe.nombre_completo,
        email: null,
        foto_url: p.profe.foto_url,
        asignaciones: [],
      } as PersonalActivoItem)
    item.asignaciones.push({
      aula_id: p.aula_id,
      aula_nombre: aulaNombre.get(p.aula_id) ?? '—',
      tipo_personal_aula: p.tipo_personal_aula,
    })
    porProfe.set(p.profe.id, item)
  }

  // Asignaciones ordenadas por relevancia del tipo (coordinadora primero) y aula.
  for (const item of porProfe.values()) {
    item.asignaciones.sort((a, b) => {
      const w =
        TIPO_PERSONAL_AULA_ORDER[a.tipo_personal_aula] -
        TIPO_PERSONAL_AULA_ORDER[b.tipo_personal_aula]
      return w !== 0 ? w : a.aula_nombre.localeCompare(b.aula_nombre)
    })
  }

  // Email por service-role (auth.users), una sola lectura.
  const emails = await emailResolver([...porProfe.keys()])
  for (const item of porProfe.values()) {
    item.email = emails.get(item.profe_id) ?? null
  }

  return [...porProfe.values()].sort((a, b) => a.nombre_completo.localeCompare(b.nombre_completo))
}

/**
 * El personal de `/admin/personal`. La lista sale de `roles_usuario` (`personalDelCentro`), no de
 * las aulas: antes, quien tenía su rol vivo y ningún aula no salía, y no había desde dónde darle
 * de baja. A cada persona activa se le ponen sus aulas del curso; una asignación sin rol vivo
 * detrás no sale (sin rol no entra a nada). Quien está de baja temporal va aparte, sin aulas.
 */
export function componerPersonal(
  personal: { activas: MiembroPersonal[]; deBaja: MiembroPersonal[] },
  conAula: PersonalActivoItem[]
): { activas: PersonalActivoItem[]; deBaja: PersonalActivoItem[] } {
  const aulasDe = new Map(conAula.map((p) => [p.profe_id, p]))
  const item = (m: MiembroPersonal, asignaciones: AsignacionPersonal[]): PersonalActivoItem => ({
    profe_id: m.usuarioId,
    nombre_completo: m.nombre,
    email: aulasDe.get(m.usuarioId)?.email ?? null,
    foto_url: m.fotoUrl,
    asignaciones,
  })
  return {
    activas: personal.activas.map((m) => item(m, aulasDe.get(m.usuarioId)?.asignaciones ?? [])),
    deBaja: personal.deBaja.map((m) => item(m, [])),
  }
}

/** `componerPersonal` con las lecturas reales. `null` si no se pudo leer quién es personal. */
export async function getPersonalDelCentro(
  centroId: string,
  cursoAcademicoId: string
): Promise<{ activas: PersonalActivoItem[]; deBaja: PersonalActivoItem[] } | null> {
  const supabase = await createClient()
  const personal = await personalDelCentro(supabase, centroId)
  if (!personal) return null
  const service = createServiceRoleClient()
  const conAula = await getPersonalActivoCentroCore(supabase, cursoAcademicoId, (ids) =>
    resolverEmailsPorId(service, ids)
  )
  const r = componerPersonal(personal, conAula)
  const sinEmail = [...r.activas, ...r.deBaja].filter((p) => !p.email).map((p) => p.profe_id)
  if (sinEmail.length > 0) {
    const emails = await resolverEmailsPorId(service, sinEmail)
    for (const p of [...r.activas, ...r.deBaja]) p.email ??= emails.get(p.profe_id) ?? null
  }
  return r
}
