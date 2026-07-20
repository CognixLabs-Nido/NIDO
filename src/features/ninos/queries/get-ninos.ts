import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { HistoricoTramo } from '@/features/ninos/lib/historico-matriculas'

export interface NinoListItem {
  id: string
  nombre: string
  // Nullable: un esqueleto de niño (alta tutor-driven) aún no tiene identidad —
  // la completa el tutor en el wizard. Solo aflora aquí (lista de gestión).
  apellidos: string | null
  fecha_nacimiento: string | null
  aula_actual: string | null
  /** estado de la matrícula vigente (fecha_baja IS NULL): 'pendiente' = esqueleto a
   *  medias; 'lista' = el tutor finalizó, pendiente de validación de la dirección. */
  estado_matricula: 'pendiente' | 'lista' | 'activa' | null
}

/**
 * Helper defensivo: Supabase puede devolver un embebido a-uno como objeto o como
 * array de un elemento (depende de cómo infiera la cardinalidad). Lo desanida a un
 * objeto plano para leer sus campos sin acoplarse a la forma concreta.
 */
function unwrap(raw: unknown): Record<string, unknown> | null {
  const obj = Array.isArray(raw) ? raw[0] : raw
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null
}

/**
 * Extrae `aulas.nombre` del embebido `aulas_curso` de una matrícula. Tras F11-H
 * (multicurso) la FK de `matriculas` es compuesta a `aulas_curso`, así que el aula
 * se anida: `aulas_curso.aulas.nombre` (cada nivel puede venir objeto o array).
 */
function extraerNombreAula(aulasCurso: unknown): string | null {
  const aula = unwrap(unwrap(aulasCurso)?.aulas)
  return aula && typeof aula.nombre === 'string' ? aula.nombre : null
}

/**
 * Como `extraerNombreAula` pero para `aulas_curso.cursos_academicos`
 * (nombre + fecha_inicio) — el curso también se anida bajo `aulas_curso`.
 */
function extraerCurso(aulasCurso: unknown): { nombre: string; fecha_inicio: string } | null {
  const curso = unwrap(unwrap(aulasCurso)?.cursos_academicos)
  if (curso && typeof curso.nombre === 'string' && typeof curso.fecha_inicio === 'string') {
    return { nombre: curso.nombre, fecha_inicio: curso.fecha_inicio }
  }
  return null
}

export async function getNinosPorCentro(centroId: string): Promise<NinoListItem[]> {
  const supabase = await createClient()
  // Doble query: niños del centro + matrícula activa para cada uno con aula.nombre.
  // Hacerlo separado evita complejidad de embebido y permite RLS independiente.
  const { data: ninos } = await supabase
    .from('ninos')
    .select('id, nombre, apellidos, fecha_nacimiento')
    .eq('centro_id', centroId)
    .is('deleted_at', null)
    .order('apellidos', { ascending: true })

  if (!ninos?.length) return []

  const { data: matriculas, error: errorMatriculas } = await supabase
    .from('matriculas')
    .select('nino_id, estado, aulas_curso(aulas(nombre))')
    .in(
      'nino_id',
      ninos.map((n) => n.id)
    )
    .is('fecha_baja', null)
    .is('deleted_at', null)
  // Un embed roto (p.ej. FK que cambió) hace fallar la query entera y devuelve `data=null`:
  // sin este log, todos los niños saldrían con estado/aula null en silencio (regresión F11-H).
  if (errorMatriculas) logger.warn('getNinosPorCentro: matriculas', errorMatriculas.message)

  const aulaPorNino = new Map<string, string>()
  const estadoPorNino = new Map<string, 'pendiente' | 'lista' | 'activa'>()
  for (const m of matriculas ?? []) {
    const nombre = extraerNombreAula(m.aulas_curso)
    if (nombre) aulaPorNino.set(m.nino_id, nombre)
    if (m.estado === 'pendiente' || m.estado === 'lista' || m.estado === 'activa')
      estadoPorNino.set(m.nino_id, m.estado)
  }

  return ninos.map((n) => ({
    ...n,
    aula_actual: aulaPorNino.get(n.id) ?? null,
    estado_matricula: estadoPorNino.get(n.id) ?? null,
  }))
}

export interface NinoArchivadoItem {
  id: string
  nombre: string
  apellidos: string | null
  /** fecha_baja de la última matrícula cerrada (la de fecha_baja más reciente). */
  fecha_baja: string | null
  motivo_baja: string | null
}

/**
 * F-3-E — niños ARCHIVADOS (dados de baja: `deleted_at IS NOT NULL`) del centro,
 * para la sección de archivo de Dirección. Deliberadamente NO reutiliza
 * `getNinosPorCentro` (ese solo lista activos). La RLS admin (`ninos_admin_all`)
 * no filtra `deleted_at`, así que basta invertir el filtro; no se toca RLS.
 *
 * Cada fila lleva `fecha_baja`/`motivo_baja` de su ÚLTIMA matrícula cerrada
 * (`estado='baja'`, la de `fecha_baja` más reciente). Las matrículas del archivado
 * siguen legibles (`archivar_nino` pone `estado='baja'`, no `matriculas.deleted_at`).
 */
export async function getNinosArchivadosPorCentro(centroId: string): Promise<NinoArchivadoItem[]> {
  const supabase = await createClient()
  const { data: ninos } = await supabase
    .from('ninos')
    .select('id, nombre, apellidos')
    .eq('centro_id', centroId)
    .not('deleted_at', 'is', null)
    // D-5: el listado de archivo (reincorporación) muestra SOLO los archivados por baja
    // ('baja_nino'). Los soft-borrados por RGPD ('solicitud_olvido'/'purga_rgpd') NO son
    // reincorporables (desarchivar_nino hace RAISE) → se ocultan para no ofrecer un
    // "Reincorporar" sobre un registro en olvido/anonimizado ('[borrado]').
    .eq('deleted_reason', 'baja_nino')
    .order('apellidos', { ascending: true })

  if (!ninos?.length) return []

  const { data: bajas } = await supabase
    .from('matriculas')
    .select('nino_id, fecha_baja, motivo_baja')
    .in(
      'nino_id',
      ninos.map((n) => n.id)
    )
    .eq('estado', 'baja')
    .is('deleted_at', null)

  // Última baja por niño (fecha_baja más reciente).
  const ultimaBaja = new Map<string, { fecha_baja: string | null; motivo_baja: string | null }>()
  for (const b of bajas ?? []) {
    const prev = ultimaBaja.get(b.nino_id)
    if (!prev || (b.fecha_baja ?? '') > (prev.fecha_baja ?? '')) {
      ultimaBaja.set(b.nino_id, { fecha_baja: b.fecha_baja, motivo_baja: b.motivo_baja })
    }
  }

  return ninos.map((n) => ({
    id: n.id,
    nombre: n.nombre,
    apellidos: n.apellidos,
    fecha_baja: ultimaBaja.get(n.id)?.fecha_baja ?? null,
    motivo_baja: ultimaBaja.get(n.id)?.motivo_baja ?? null,
  }))
}

export interface NinoDetalle {
  id: string
  centro_id: string
  nombre: string
  // Nullable en el esqueleto (alta tutor-driven): el tutor completa identidad en el wizard.
  apellidos: string | null
  fecha_nacimiento: string | null
  sexo: 'F' | 'M' | 'X' | null
  nacionalidad: string | null
  idioma_principal: string
  notas_admin: string | null
  puede_aparecer_en_fotos: boolean
  /** Ruta en Storage (bucket privado `ninos-fotos`); se firma para mostrar. F10-3. */
  foto_url: string | null
  /** F-3-E: NULL = activo; con valor = archivado (dado de baja). */
  deleted_at: string | null
}

/**
 * Ficha de un niño por id. Por defecto SOLO devuelve niños activos
 * (`deleted_at IS NULL`) — el comportamiento histórico del que dependen la vista
 * del tutor (`/family/nino/[id]`) y el alta (`/alta/[ninoId]`): un archivado da
 * `notFound()`.
 *
 * F-3-E — con `incluirArchivado: true` NO se aplica ese filtro, de modo que un
 * niño dado de baja se puede abrir en solo-lectura. Esta puerta la usa SOLO la
 * ficha de Dirección (`/admin/ninos/[id]`, ya gateada a admin por ruta + RLS);
 * no se relaja el filtro por defecto de los demás llamadores.
 */
export async function getNinoById(
  ninoId: string,
  opts?: { incluirArchivado?: boolean }
): Promise<NinoDetalle | null> {
  const supabase = await createClient()
  let query = supabase
    .from('ninos')
    .select(
      'id, centro_id, nombre, apellidos, fecha_nacimiento, sexo, nacionalidad, idioma_principal, notas_admin, puede_aparecer_en_fotos, foto_url, deleted_at'
    )
    .eq('id', ninoId)
  if (!opts?.incluirArchivado) query = query.is('deleted_at', null)
  const { data } = await query.maybeSingle()
  return (data as NinoDetalle | null) ?? null
}

export interface InfoMedica {
  alergias_graves: string | null
  notas_emergencia: string | null
  medicacion_habitual: string | null
  alergias_leves: string | null
  medico_familia: string | null
  telefono_emergencia: string | null
}

export async function getInfoMedica(ninoId: string): Promise<InfoMedica | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_info_medica_emergencia', { p_nino_id: ninoId })
  if (error || !data || data.length === 0) return null
  const row = data[0]
  return {
    alergias_graves: row.alergias_graves ?? null,
    notas_emergencia: row.notas_emergencia ?? null,
    medicacion_habitual: row.medicacion_habitual ?? null,
    alergias_leves: row.alergias_leves ?? null,
    medico_familia: row.medico_familia ?? null,
    telefono_emergencia: row.telefono_emergencia ?? null,
  }
}

export interface MatriculaItem {
  id: string
  aula_id: string
  aula_nombre: string
  fecha_alta: string
  fecha_baja: string | null
  motivo_baja: string | null
  estado: 'pendiente' | 'lista' | 'activa' | 'baja'
}

export async function getMatriculasPorNino(ninoId: string): Promise<MatriculaItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('matriculas')
    .select('id, aula_id, fecha_alta, fecha_baja, motivo_baja, estado, aulas_curso(aulas(nombre))')
    .eq('nino_id', ninoId)
    .is('deleted_at', null)
    .order('fecha_alta', { ascending: false })
  if (error) logger.warn('getMatriculasPorNino', error.message)

  return (data ?? []).map((m) => ({
    id: m.id,
    aula_id: m.aula_id,
    aula_nombre: extraerNombreAula(m.aulas_curso) ?? '—',
    fecha_alta: m.fecha_alta,
    fecha_baja: m.fecha_baja,
    motivo_baja: m.motivo_baja,
    estado: m.estado,
  }))
}

/**
 * F-8 — Histórico del niño (recorrido por aulas/cursos). Hermana de
 * `getMatriculasPorNino`: además del aula trae el CURSO académico (nombre + fecha_inicio)
 * para poder agrupar por año. Devuelve TODOS los tramos (incl. pendiente/lista/baja) — la
 * RLS admin ya permite ver todo el histórico, incluidos niños archivados. El agrupado y el
 * orden final los hace `agruparHistoricoPorCurso` (lib pura); aquí solo se filtra el
 * soft-delete y se ordena por `fecha_alta` como base estable.
 */
export async function getHistoricoMatriculas(ninoId: string): Promise<HistoricoTramo[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('matriculas')
    .select(
      'id, aula_id, curso_academico_id, fecha_alta, fecha_baja, motivo_baja, estado, aulas_curso(aulas(nombre), cursos_academicos(nombre, fecha_inicio))'
    )
    .eq('nino_id', ninoId)
    .is('deleted_at', null)
    .order('fecha_alta', { ascending: true })
  if (error) logger.warn('getHistoricoMatriculas', error.message)

  return (data ?? []).map((m) => {
    const curso = extraerCurso(m.aulas_curso)
    return {
      id: m.id,
      aula_id: m.aula_id,
      aula_nombre: extraerNombreAula(m.aulas_curso) ?? '—',
      curso_id: m.curso_academico_id,
      curso_nombre: curso?.nombre ?? '—',
      curso_fecha_inicio: curso?.fecha_inicio ?? '',
      fecha_alta: m.fecha_alta,
      fecha_baja: m.fecha_baja,
      motivo_baja: m.motivo_baja,
      estado: m.estado,
    }
  })
}
