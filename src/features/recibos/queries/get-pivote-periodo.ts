import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import {
  construirPivote,
  type LineaPivoteInput,
  type PivoteRecibos,
  type ReciboPivoteInput,
} from '../lib/pivote'

const PIVOTE_VACIA: PivoteRecibos = {
  columnas: [],
  filas: [],
  totalesColumna: {},
  totalGeneral: 0,
}

/**
 * Pivote de recibos del período (centro, anio, mes) para dirección (F12-B-7). RLS: solo
 * admin del centro ve los recibos. Trae recibos + sus líneas + nombres de niño, tutor
 * legal principal y concepto en consultas separadas (las tablas B-0 se tiparon a mano sin
 * `Relationships`, así que los embeds foráneos no tipan — join en memoria) y delega en el
 * builder puro. Incluye regulares, esporádicos y re-giros (cada recibo es una fila).
 */
export async function getPivotePeriodo(
  centroId: string,
  anio: number,
  mes: number
): Promise<PivoteRecibos> {
  const supabase = await createClient()

  const { data: recibos, error } = await supabase
    .from('recibos')
    .select('id, nino_id, estado, metodo, total_centimos, es_esporadico, devuelto_de_recibo_id')
    .eq('centro_id', centroId)
    .eq('anio', anio)
    .eq('mes', mes)
    .is('deleted_at', null)

  if (error) {
    logger.warn('getPivotePeriodo: recibos', error.message)
    return PIVOTE_VACIA
  }
  if (!recibos || recibos.length === 0) return PIVOTE_VACIA

  // F-4-1: los recibos REGULARES pasan a grano familia (nino_id NULL). Este pivote por-niño
  // se rehace a grano familia en F-4-4; hasta entonces solo incluye recibos con nino_id.
  const recibosConNino = recibos.filter((r): r is typeof r & { nino_id: string } => r.nino_id != null)

  const reciboIds = recibosConNino.map((r) => r.id)
  const ninoIds = [...new Set(recibosConNino.map((r) => r.nino_id))]

  const [lineasRes, ninosRes, vinculosRes, conceptosRes] = await Promise.all([
    supabase
      .from('lineas_recibo')
      .select('recibo_id, concepto_id, descripcion, importe_centimos')
      .in('recibo_id', reciboIds),
    supabase.from('ninos').select('id, nombre, apellidos').in('id', ninoIds),
    supabase
      .from('vinculos_familiares')
      .select('nino_id, tipo_vinculo, usuario:usuarios!inner(nombre_completo)')
      .in('nino_id', ninoIds)
      .eq('tipo_vinculo', 'tutor_legal_principal')
      .is('deleted_at', null),
    supabase.from('conceptos_cobro').select('id, nombre').eq('centro_id', centroId),
  ])

  const ninoNombre = new Map(
    (ninosRes.data ?? []).map((n) => [n.id, [n.nombre, n.apellidos].filter(Boolean).join(' ')])
  )
  const tutorNombre = new Map(
    (vinculosRes.data ?? []).map((v) => [v.nino_id, v.usuario?.nombre_completo ?? ''])
  )
  const conceptoNombre = new Map((conceptosRes.data ?? []).map((c) => [c.id, c.nombre]))

  const recibosInput: ReciboPivoteInput[] = recibosConNino.map((r) => ({
    id: r.id,
    ninoId: r.nino_id,
    estado: r.estado,
    metodo: r.metodo,
    totalCentimos: r.total_centimos,
    esEsporadico: r.es_esporadico,
    esRegiro: r.devuelto_de_recibo_id != null,
  }))

  const lineasInput: LineaPivoteInput[] = (lineasRes.data ?? []).map((l) => ({
    reciboId: l.recibo_id,
    conceptoId: l.concepto_id,
    descripcion: l.descripcion,
    importeCentimos: l.importe_centimos,
  }))

  return construirPivote(recibosInput, lineasInput, {
    ninoNombre,
    tutorNombre,
    conceptoNombre,
  })
}
