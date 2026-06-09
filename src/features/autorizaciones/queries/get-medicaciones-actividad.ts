import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { hoyMadridYmd } from '../lib/server-helpers'
import type { AutorizacionEstado } from '../types'

/** Una pauta de medicación con su actividad y estado de archivado, para la lista. */
export interface MedicacionActividad {
  id: string
  titulo: string
  nino_id: string | null
  nino_nombre: string | null
  estado: AutorizacionEstado
  /** Fecha de fin de la pauta (vigencia_hasta). null = sin fin marcado. */
  fechaFin: string | null
  /** hoy > fechaFin → ya no hay que darla (candidata a archivar). */
  terminada: boolean
  archivada: boolean
  /** Administraciones registradas (dosis dadas). */
  dadas: number
  /** Administraciones aún sin confirmar por un 2.º staff. */
  pendientesConfirmar: number
}

/**
 * Pautas de medicación (instancias) del ámbito del usuario (RLS: profe→aula,
 * admin→centro, familia→hijos) con la ACTIVIDAD de cada una: dosis dadas y
 * pendientes de confirmar, leídas de `administraciones_medicacion`. `archivadas`
 * elige entre la lista de trabajo (activas) y el HISTÓRICO (archivadas).
 */
export async function getMedicacionesConActividad(
  archivadas = false
): Promise<MedicacionActividad[]> {
  const supabase = await createClient()

  let q = supabase
    .from('autorizaciones')
    .select('id, titulo, nino_id, estado, vigencia_hasta, archivada_at, created_at')
    .eq('tipo', 'medicacion')
    .eq('es_plantilla', false)
    .order('created_at', { ascending: false })
  q = archivadas ? q.not('archivada_at', 'is', null) : q.is('archivada_at', null)

  const { data: meds, error } = await q
  if (error) {
    logger.warn('getMedicacionesConActividad', error.message)
    return []
  }
  if (!meds || meds.length === 0) return []

  const ids = meds.map((m) => m.id)
  const ninoIds = Array.from(new Set(meds.map((m) => m.nino_id).filter(Boolean) as string[]))

  const [{ data: admins }, { data: ninos }] = await Promise.all([
    supabase
      .from('administraciones_medicacion')
      .select('autorizacion_id, confirmado_por')
      .in('autorizacion_id', ids),
    ninoIds.length
      ? supabase.from('ninos').select('id, nombre, apellidos').in('id', ninoIds)
      : Promise.resolve({ data: [] as { id: string; nombre: string; apellidos: string }[] }),
  ])

  const dadasPorAut = new Map<string, number>()
  const pendientesPorAut = new Map<string, number>()
  for (const a of admins ?? []) {
    dadasPorAut.set(a.autorizacion_id, (dadasPorAut.get(a.autorizacion_id) ?? 0) + 1)
    if (a.confirmado_por === null) {
      pendientesPorAut.set(a.autorizacion_id, (pendientesPorAut.get(a.autorizacion_id) ?? 0) + 1)
    }
  }
  const nombrePorNino = new Map<string, string>()
  for (const n of ninos ?? []) nombrePorNino.set(n.id, `${n.nombre} ${n.apellidos}`)

  const hoy = hoyMadridYmd()
  return meds.map((m) => ({
    id: m.id,
    titulo: m.titulo,
    nino_id: m.nino_id,
    nino_nombre: m.nino_id ? (nombrePorNino.get(m.nino_id) ?? null) : null,
    estado: m.estado,
    fechaFin: m.vigencia_hasta,
    terminada: !!m.vigencia_hasta && hoy > m.vigencia_hasta,
    archivada: m.archivada_at !== null,
    dadas: dadasPorAut.get(m.id) ?? 0,
    pendientesConfirmar: pendientesPorAut.get(m.id) ?? 0,
  }))
}
