import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import {
  BUCKET_NINOS_FOTOS,
  BUCKET_RECOGIDA_ADJUNTOS,
  rutaThumbDe,
} from '@/shared/lib/adjuntos/storage'

import { BUCKET_AULA_FOTOS } from '@/features/fotos/types'

import {
  GRACIA_ESQUELETO_DIAS,
  RETENCION_FOTOS_MESES,
  RETENCION_RECOGIDA_HABITUAL_MESES,
  RETENCION_RECOGIDA_PUNTUAL_DIAS,
  type RetencionCategoria,
  type UnidadRetencion,
} from '../types'

type Service = SupabaseClient<Database>

// =============================================================================
// Predicados PUROS (testables sin BD)
// =============================================================================

/** `ahoraISO` − N días/meses → fecha de corte 'YYYY-MM-DD' (huso local del server). */
export function cutoffFecha(ahoraISO: string, periodo: { dias?: number; meses?: number }): string {
  const d = new Date(ahoraISO)
  if (periodo.dias) d.setDate(d.getDate() - periodo.dias)
  if (periodo.meses) d.setMonth(d.getMonth() - periodo.meses)
  return d.toISOString().slice(0, 10)
}

/** Recogida PUNTUAL vencida: tiene `vigencia_hasta` y ya pasó el corte (hoy−7d). */
export function recogidaPuntualVencida(vigenciaHasta: string | null, cutoff: string): boolean {
  return vigenciaHasta != null && vigenciaHasta < cutoff
}

/** Fila mínima de matrícula para el cálculo de "vencido por baja". */
export interface MatriculaMin {
  nino_id: string
  fecha_baja: string | null
}

/**
 * Niños "vencidos por baja": sin NINGUNA matrícula activa (`fecha_baja IS NULL`) y
 * cuya baja MÁS RECIENTE es anterior al corte. Puro: recibe todas las filas de
 * matrícula y la fecha de corte ('YYYY-MM-DD').
 */
export function ninosVencidosPorBaja(filas: readonly MatriculaMin[], cutoff: string): Set<string> {
  const porNino = new Map<string, { activa: boolean; ultimaBaja: string | null }>()
  for (const f of filas) {
    const acc = porNino.get(f.nino_id) ?? { activa: false, ultimaBaja: null }
    if (f.fecha_baja == null) acc.activa = true
    else if (acc.ultimaBaja == null || f.fecha_baja > acc.ultimaBaja) acc.ultimaBaja = f.fecha_baja
    porNino.set(f.nino_id, acc)
  }
  const out = new Set<string>()
  for (const [ninoId, { activa, ultimaBaja }] of porNino) {
    if (!activa && ultimaBaja != null && ultimaBaja < cutoff) out.add(ninoId)
  }
  return out
}

// -----------------------------------------------------------------------------
// Esqueleto huérfano (A6): alta tutor-driven abandonada. Predicados PUROS.
// -----------------------------------------------------------------------------

/** `ahoraISO` − N días → instante de corte ISO (timestamptz). */
export function cutoffTimestamp(ahoraISO: string, dias: number): string {
  const d = new Date(ahoraISO)
  d.setDate(d.getDate() - dias)
  return d.toISOString()
}

/** Fila mínima de invitación para el predicado de esqueleto huérfano. */
export interface InvitacionMin {
  accepted_at: string | null
  rejected_at: string | null
  expires_at: string
}

/** Fila mínima de matrícula para el predicado de esqueleto huérfano. */
export interface MatriculaEstadoMin {
  estado: string
  fecha_baja: string | null
  deleted_at: string | null
}

const invitacionAbierta = (i: InvitacionMin): boolean =>
  i.accepted_at == null && i.rejected_at == null

/** Invitación abierta y ya vencida (más allá de la gracia): `expires_at < cutoff`. */
export function invitacionVencida(i: InvitacionMin, cutoffISO: string): boolean {
  return invitacionAbierta(i) && new Date(i.expires_at).getTime() < new Date(cutoffISO).getTime()
}

/** Invitación abierta y aún válida (dentro de gracia): `expires_at >= cutoff`. Protege. */
export function invitacionAbiertaValida(i: InvitacionMin, cutoffISO: string): boolean {
  return invitacionAbierta(i) && new Date(i.expires_at).getTime() >= new Date(cutoffISO).getTime()
}

/** Datos mínimos de un niño para decidir si es esqueleto huérfano. */
export interface NinoEsqueletoInput {
  matriculas: readonly MatriculaEstadoMin[]
  /** nº de `vinculos_familiares` activos (deleted_at IS NULL). */
  vinculosActivos: number
  invitaciones: readonly InvitacionMin[]
}

/**
 * Esqueleto huérfano = alta nunca completada: matrícula 'pendiente' viva + SIN
 * vínculos activos (nadie aceptó) + ALGUNA invitación vencida tras gracia + NINGUNA
 * invitación abierta-válida (nadie la reactivó). Puro: recibe filas ya cargadas.
 */
export function esEsqueletoHuerfano(input: NinoEsqueletoInput, cutoffISO: string): boolean {
  const tienePendiente = input.matriculas.some(
    (m) => m.estado === 'pendiente' && m.fecha_baja == null && m.deleted_at == null
  )
  if (!tienePendiente) return false
  if (input.vinculosActivos > 0) return false
  const hayVencida = input.invitaciones.some((i) => invitacionVencida(i, cutoffISO))
  const hayAbiertaValida = input.invitaciones.some((i) => invitacionAbiertaValida(i, cutoffISO))
  return hayVencida && !hayAbiertaValida
}

/** Adjuntos de una firma que viven en `recogida-adjuntos` → rutas. */
export function pathsDniRecogida(datos: unknown): string[] {
  if (!datos || typeof datos !== 'object') return []
  const adj = (datos as { adjuntos?: unknown }).adjuntos
  if (!Array.isArray(adj)) return []
  return adj
    .filter(
      (a): a is { bucket: string; path: string } =>
        Boolean(a) &&
        typeof a === 'object' &&
        (a as { bucket?: unknown }).bucket === BUCKET_RECOGIDA_ADJUNTOS &&
        typeof (a as { path?: unknown }).path === 'string'
    )
    .map((a) => a.path)
}

// =============================================================================
// Listados por categoría (consultan BD con el service client → bypass RLS)
// =============================================================================

/** Conjunto de niños vencidos por baja (cutoff = hoy − `meses`), una sola query. */
async function ninosVencidos(
  service: Service,
  ahoraISO: string,
  meses: number
): Promise<Set<string>> {
  const { data } = await service.from('matriculas').select('nino_id, fecha_baja')
  return ninosVencidosPorBaja(data ?? [], cutoffFecha(ahoraISO, { meses }))
}

/**
 * DNIs de recogida (#7: se purga SOLO el objeto; la firma y su `datos.adjuntos`/hash
 * se conservan). Puntual → `vigencia_hasta < hoy−7d`; habitual (`vigencia_hasta`
 * NULL) → el niño lleva >12m sin matrícula activa.
 */
async function listarDniRecogida(service: Service, ahoraISO: string): Promise<UnidadRetencion[]> {
  const cutoffPuntual = cutoffFecha(ahoraISO, { dias: RETENCION_RECOGIDA_PUNTUAL_DIAS })
  const vencidosBaja = await ninosVencidos(service, ahoraISO, RETENCION_RECOGIDA_HABITUAL_MESES)

  const { data } = await service
    .from('firmas_autorizacion')
    .select('id, nino_id, datos, autorizaciones!inner(tipo, vigencia_hasta, centro_id)')
    .eq('autorizaciones.tipo', 'recogida')

  const unidades: UnidadRetencion[] = []
  for (const f of data ?? []) {
    const aut = (f as { autorizaciones: { vigencia_hasta: string | null; centro_id: string } })
      .autorizaciones
    const paths = pathsDniRecogida(f.datos)
    if (paths.length === 0) continue

    let motivo: string | null = null
    if (recogidaPuntualVencida(aut.vigencia_hasta, cutoffPuntual)) motivo = 'puntual_vencida'
    else if (aut.vigencia_hasta == null && vencidosBaja.has(f.nino_id)) motivo = 'habitual_baja_12m'
    if (!motivo) continue

    unidades.push({
      categoria: 'dni_recogida',
      centroId: aut.centro_id,
      refTipo: 'firma',
      refId: f.id,
      bucket: BUCKET_RECOGIDA_ADJUNTOS,
      paths,
      motivo,
    })
  }
  return unidades
}

/** Foto de la ficha (`ninos-fotos`) de niños vencidos por baja (+12m). */
async function listarFotoPerfil(service: Service, ahoraISO: string): Promise<UnidadRetencion[]> {
  const vencidos = await ninosVencidos(service, ahoraISO, RETENCION_FOTOS_MESES)
  if (vencidos.size === 0) return []

  const { data } = await service
    .from('ninos')
    .select('id, centro_id, foto_url')
    .in('id', [...vencidos])

  const unidades: UnidadRetencion[] = []
  for (const n of data ?? []) {
    if (!n.foto_url) continue
    unidades.push({
      categoria: 'foto_perfil_nino',
      centroId: n.centro_id,
      refTipo: 'nino',
      refId: n.id,
      bucket: BUCKET_NINOS_FOTOS,
      paths: [n.foto_url, rutaThumbDe(n.foto_url)],
      motivo: 'baja_12m',
    })
  }
  return unidades
}

/**
 * Blog (`aula-fotos`): media donde un niño vencido es el ÚNICO etiquetado (#5).
 * Una unidad por niño con todos sus objetos exclusivos. Las fotos COMPARTIDAS se
 * conservan (solo se les quita la etiqueta en `limpiarDb`, sin borrar el objeto).
 */
async function listarFotoBlog(service: Service, ahoraISO: string): Promise<UnidadRetencion[]> {
  const vencidos = await ninosVencidos(service, ahoraISO, RETENCION_FOTOS_MESES)
  if (vencidos.size === 0) return []

  const unidades: UnidadRetencion[] = []
  for (const ninoId of vencidos) {
    const exclusivos = await mediaExclusivaDe(service, ninoId)
    if (exclusivos.length === 0) continue
    const { data: media } = await service
      .from('media')
      .select('centro_id, path, path_miniatura')
      .in('id', exclusivos)
    const filas = media ?? []
    if (filas.length === 0) continue
    unidades.push({
      categoria: 'foto_blog_exclusiva',
      centroId: filas[0].centro_id,
      refTipo: 'nino',
      refId: ninoId,
      bucket: BUCKET_AULA_FOTOS,
      paths: filas.flatMap((m) =>
        [m.path, m.path_miniatura].filter((p): p is string => Boolean(p))
      ),
      motivo: 'baja_12m',
    })
  }
  return unidades
}

/** ids de `media` donde el niño es el ÚNICO etiquetado (#5). */
async function mediaExclusivaDe(service: Service, ninoId: string): Promise<string[]> {
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
  return mediaIds.filter((mid) =>
    (todas ?? []).filter((t) => t.media_id === mid).every((t) => t.nino_id === ninoId)
  )
}

/**
 * Esqueleto huérfano (A6): niños con alta abandonada. Dry-run friendly (solo lee).
 * El borrado real lo hace `limpiarDb` vía la RPC atómica `purgar_esqueleto_huerfano_nino`
 * (re-valida el predicado server-side y aborta si aparece actividad real). Sin Storage.
 */
async function listarEsqueletoHuerfano(
  service: Service,
  ahoraISO: string
): Promise<UnidadRetencion[]> {
  const cutoff = cutoffTimestamp(ahoraISO, GRACIA_ESQUELETO_DIAS)

  // Anclaje: niños con matrícula 'pendiente' viva (acota el universo).
  const { data: pend } = await service
    .from('matriculas')
    .select('nino_id')
    .eq('estado', 'pendiente')
    .is('fecha_baja', null)
    .is('deleted_at', null)
  const ninoIds = [...new Set((pend ?? []).map((m) => m.nino_id))]
  if (ninoIds.length === 0) return []

  const [{ data: ninos }, { data: mats }, { data: vincs }, { data: invs }] = await Promise.all([
    service.from('ninos').select('id, centro_id').in('id', ninoIds),
    service
      .from('matriculas')
      .select('nino_id, estado, fecha_baja, deleted_at')
      .in('nino_id', ninoIds),
    service
      .from('vinculos_familiares')
      .select('nino_id')
      .in('nino_id', ninoIds)
      .is('deleted_at', null),
    service
      .from('invitaciones')
      .select('nino_id, accepted_at, rejected_at, expires_at')
      .in('nino_id', ninoIds),
  ])

  const unidades: UnidadRetencion[] = []
  for (const n of ninos ?? []) {
    const input: NinoEsqueletoInput = {
      matriculas: (mats ?? []).filter((m) => m.nino_id === n.id),
      vinculosActivos: (vincs ?? []).filter((v) => v.nino_id === n.id).length,
      invitaciones: (invs ?? []).filter((i) => i.nino_id === n.id),
    }
    if (!esEsqueletoHuerfano(input, cutoff)) continue
    unidades.push({
      categoria: 'esqueleto_huerfano',
      centroId: n.centro_id,
      refTipo: 'nino',
      refId: n.id,
      bucket: '',
      paths: [],
      motivo: 'alta_abandonada',
    })
  }
  return unidades
}

// =============================================================================
// Manifiesto declarativo (extensible — D7: añadir categorías sin reescribir el
// orquestador; p. ej. agendas/asistencias/mensajes cuando lo fije F11-B).
// =============================================================================

export interface FuenteRetencion {
  nombre: string
  categoria: RetencionCategoria
  /** Lista las unidades vencidas (predicado por tiempo). */
  listar(service: Service, ahoraISO: string): Promise<UnidadRetencion[]>
  /** Limpieza de BD tras borrar los objetos (solo purga real). Ausente = no-op. */
  limpiarDb?(service: Service, unidad: UnidadRetencion): Promise<void>
}

export const FUENTES_RETENCION: readonly FuenteRetencion[] = [
  // DNI de recogida: NO se toca BD (la firma y su hash se conservan, #7).
  { nombre: 'dni-recogida', categoria: 'dni_recogida', listar: listarDniRecogida },
  // Foto de ficha: tras borrar el objeto, se anula `foto_url`.
  {
    nombre: 'foto-perfil-nino',
    categoria: 'foto_perfil_nino',
    listar: listarFotoPerfil,
    async limpiarDb(service, u) {
      await service.from('ninos').update({ foto_url: null }).eq('id', u.refId)
    },
  },
  // Blog: borra las filas `media` exclusivas (cascada de etiquetas) y quita la
  // etiqueta del niño en las COMPARTIDAS (se conserva el objeto de terceros, #5).
  {
    nombre: 'foto-blog-exclusiva',
    categoria: 'foto_blog_exclusiva',
    listar: listarFotoBlog,
    async limpiarDb(service, u) {
      const exclusivos = await mediaExclusivaDe(service, u.refId)
      if (exclusivos.length > 0) await service.from('media').delete().in('id', exclusivos)
      await service.from('media_etiquetas').delete().eq('nino_id', u.refId)
    },
  },
  // Esqueleto huérfano (A6): alta abandonada → borrado PERMANENTE atómico vía RPC.
  // La RPC re-valida el predicado (TOCTOU) y aborta el huérfano CONCRETO si topa con
  // actividad real; el throw lo captura el orquestador (cuenta fallidos, sigue la tanda).
  {
    nombre: 'esqueleto-huerfano-nino',
    categoria: 'esqueleto_huerfano',
    listar: listarEsqueletoHuerfano,
    async limpiarDb(service, u) {
      const cutoff = cutoffTimestamp(new Date().toISOString(), GRACIA_ESQUELETO_DIAS)
      const { error } = await service.rpc('purgar_esqueleto_huerfano_nino', {
        p_nino_id: u.refId,
        p_cutoff: cutoff,
      })
      if (error) throw new Error(`purgar_esqueleto_huerfano_nino(${u.refId}): ${error.message}`)
    },
  },
]
