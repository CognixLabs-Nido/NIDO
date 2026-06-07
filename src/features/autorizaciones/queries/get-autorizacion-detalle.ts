import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import {
  calcularEstadoNino,
  firmasVigentesPorFirmante,
  type FirmaEfectiva,
  type FirmanteVinculo,
} from '../lib/estado-firma'
import { hoyMadridYmd } from '../lib/server-helpers'
import type { AutorizacionDetalle, PoliticaFirmantes, RosterFirmaNino } from '../types'

/**
 * Detalle de una autorización + su **roster por niño** (estado de firma calculado
 * según `firmantes_requeridos`, con override por niño cuando
 * `ninos.requiere_ambos_firmantes`). Todo bajo RLS: el staff ve todos los niños
 * de la audiencia del evento; la familia ve solo a sus hijos. Devuelve `null` si
 * no existe o el usuario no es audiencia.
 */
export async function getAutorizacionDetalle(
  autorizacionId: string
): Promise<AutorizacionDetalle | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: aut, error } = await supabase
    .from('autorizaciones')
    .select(
      'id, tipo, titulo, texto, texto_version, texto_definitivo, estado, firmantes_requeridos, evento_id, nino_id, aula_id, es_plantilla, ambito, plantilla_id, centro_id, vigencia_desde, vigencia_hasta, creado_por'
    )
    .eq('id', autorizacionId)
    .maybeSingle()
  if (error) {
    logger.warn('getAutorizacionDetalle: select', error.message)
    return null
  }
  if (!aut) return null

  // Las plantillas del catálogo no se firman → sin roster. Las instancias
  // resuelven sus niños por evento (salida) o por ámbito (A) / niño (B2/legacy).
  const ninoIds = aut.es_plantilla ? [] : await resolverNinosEnAlcance(supabase, aut)

  const roster = ninoIds.length
    ? await construirRoster(supabase, aut.id, aut.firmantes_requeridos, ninoIds)
    : []

  const hoy = hoyMadridYmd()
  const firmable =
    !aut.es_plantilla &&
    aut.estado === 'publicada' &&
    aut.texto_definitivo &&
    (!aut.vigencia_desde || hoy >= aut.vigencia_desde) &&
    (!aut.vigencia_hasta || hoy <= aut.vigencia_hasta)

  return {
    id: aut.id,
    tipo: aut.tipo,
    titulo: aut.titulo,
    texto: aut.texto,
    texto_version: aut.texto_version,
    texto_definitivo: aut.texto_definitivo,
    estado: aut.estado,
    firmantes_requeridos: aut.firmantes_requeridos,
    evento_id: aut.evento_id,
    nino_id: aut.nino_id,
    es_plantilla: aut.es_plantilla,
    ambito: aut.ambito,
    plantilla_id: aut.plantilla_id,
    vigencia_desde: aut.vigencia_desde,
    vigencia_hasta: aut.vigencia_hasta,
    firmable,
    es_autor: !!user && aut.creado_por === user.id,
    roster,
  }
}

type AutMin = {
  id: string
  tipo: string
  evento_id: string | null
  nino_id: string | null
  aula_id: string | null
  ambito: string | null
  centro_id: string
}

/**
 * Resuelve el set de niños visibles de una INSTANCIA:
 *  - salida → la audiencia del evento (niño/aula/centro).
 *  - patrón A (ambito) → niño/aula(matrículas)/centro.
 *  - B2 (ambito='nino') o legacy (sin ambito) → el niño directo.
 */
async function resolverNinosEnAlcance(
  supabase: Awaited<ReturnType<typeof createClient>>,
  aut: AutMin
): Promise<string[]> {
  if (aut.tipo === 'salida') {
    if (!aut.evento_id) return []
    const { data: ev } = await supabase
      .from('eventos')
      .select('ambito, aula_id, nino_id, centro_id')
      .eq('id', aut.evento_id)
      .maybeSingle()
    if (!ev) return []
    if (ev.ambito === 'nino' && ev.nino_id) return [ev.nino_id]
    if (ev.ambito === 'aula' && ev.aula_id) return ninosDeAula(supabase, ev.aula_id)
    if (ev.ambito === 'centro') return ninosDeCentro(supabase, ev.centro_id)
    return []
  }

  // Instancia A enviada a aula/centro.
  if (aut.ambito === 'aula' && aut.aula_id) return ninosDeAula(supabase, aut.aula_id)
  if (aut.ambito === 'centro') return ninosDeCentro(supabase, aut.centro_id)

  // ambito='nino' (A/B2) o legacy (sin ambito): el niño directo.
  return aut.nino_id ? [aut.nino_id] : []
}

async function ninosDeAula(
  supabase: Awaited<ReturnType<typeof createClient>>,
  aulaId: string
): Promise<string[]> {
  const { data: mats } = await supabase
    .from('matriculas')
    .select('nino_id')
    .eq('aula_id', aulaId)
    .is('fecha_baja', null)
    .is('deleted_at', null)
  return (mats ?? []).map((m) => m.nino_id)
}

async function ninosDeCentro(
  supabase: Awaited<ReturnType<typeof createClient>>,
  centroId: string
): Promise<string[]> {
  const { data: ns } = await supabase
    .from('ninos')
    .select('id')
    .eq('centro_id', centroId)
    .is('deleted_at', null)
  return (ns ?? []).map((n) => n.id)
}

/** Construye el roster por niño con la política efectiva (override per-niño). */
async function construirRoster(
  supabase: Awaited<ReturnType<typeof createClient>>,
  autorizacionId: string,
  politicaAut: PoliticaFirmantes,
  ninoIds: string[]
): Promise<RosterFirmaNino[]> {
  const [{ data: ninos }, { data: vinculos }, { data: firmas }] = await Promise.all([
    supabase
      .from('ninos')
      .select('id, nombre, apellidos, requiere_ambos_firmantes')
      .in('id', ninoIds)
      .is('deleted_at', null),
    supabase
      .from('vinculos_familiares')
      .select('nino_id, usuario_id, tipo_vinculo')
      .in('nino_id', ninoIds)
      .is('deleted_at', null),
    supabase
      .from('firmas_autorizacion')
      .select('nino_id, firmante_id, decision, firmado_at')
      .eq('autorizacion_id', autorizacionId)
      .in('nino_id', ninoIds),
  ])

  // Nombres de los firmantes (puede no resolverse por RLS → fallback en UI).
  const firmanteIds = Array.from(new Set((vinculos ?? []).map((v) => v.usuario_id)))
  const nombrePorUsuario = new Map<string, string>()
  if (firmanteIds.length) {
    const { data: us } = await supabase
      .from('usuarios')
      .select('id, nombre_completo')
      .in('id', firmanteIds)
    for (const u of us ?? []) nombrePorUsuario.set(u.id, u.nombre_completo)
  }

  const vinculosPorNino = new Map<string, FirmanteVinculo[]>()
  for (const v of vinculos ?? []) {
    const arr = vinculosPorNino.get(v.nino_id) ?? []
    arr.push({
      firmante_id: v.usuario_id,
      firmante_nombre: nombrePorUsuario.get(v.usuario_id) ?? '',
      rol_firmante: v.tipo_vinculo,
      es_principal: v.tipo_vinculo === 'tutor_legal_principal',
    })
    vinculosPorNino.set(v.nino_id, arr)
  }

  const firmasPorNino = new Map<string, FirmaEfectiva[]>()
  for (const f of firmas ?? []) {
    const arr = firmasPorNino.get(f.nino_id) ?? []
    arr.push({ firmante_id: f.firmante_id, decision: f.decision, firmado_at: f.firmado_at })
    firmasPorNino.set(f.nino_id, arr)
  }

  return (ninos ?? [])
    .map((n) => {
      // Override per-niño: si el niño exige ambos firmantes, prevalece sobre la
      // política de la autorización (minimización: el requisito vive en el niño).
      const politica: PoliticaFirmantes = n.requiere_ambos_firmantes
        ? 'todos_los_principales'
        : politicaAut
      const vinculosNino = vinculosPorNino.get(n.id) ?? []
      const vigentes = firmasVigentesPorFirmante(firmasPorNino.get(n.id) ?? [])
      const { estado, firmantes } = calcularEstadoNino(politica, vinculosNino, vigentes)
      return {
        nino_id: n.id,
        nino_nombre: `${n.nombre} ${n.apellidos}`.trim(),
        estado,
        firmantes,
      } satisfies RosterFirmaNino
    })
    .sort((a, b) => a.nino_nombre.localeCompare(b.nino_nombre))
}
