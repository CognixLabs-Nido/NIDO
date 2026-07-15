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
 * Pivote de recibos del período (centro, anio, mes) para dirección (F12-B-7, rehecho a
 * grano FAMILIA en F-4-4). RLS: solo admin del centro ve los recibos. Incluye TODOS los
 * recibos del mes (regulares familiares, esporádicos y re-giros: cada recibo es una fila).
 * La «fila» se etiqueta por FAMILIA: la columna «tutor» muestra la etiqueta de la familia
 * y la «niño» sus tutores. Trae recibos + líneas + familia + tutores + conceptos en
 * consultas separadas (las tablas B-0 se tiparon a mano sin `Relationships`) y delega en
 * el builder puro, reusando el slot `ninoId` como `familia_id`.
 */
export async function getPivotePeriodo(
  centroId: string,
  anio: number,
  mes: number
): Promise<PivoteRecibos> {
  const supabase = await createClient()

  const { data: recibos, error } = await supabase
    .from('recibos')
    .select('id, familia_id, estado, metodo, total_centimos, es_esporadico, devuelto_de_recibo_id')
    .eq('centro_id', centroId)
    .eq('anio', anio)
    .eq('mes', mes)
    .is('deleted_at', null)

  if (error) {
    logger.warn('getPivotePeriodo: recibos', error.message)
    return PIVOTE_VACIA
  }
  if (!recibos || recibos.length === 0) return PIVOTE_VACIA

  const recibosConFamilia = recibos.filter(
    (r): r is typeof r & { familia_id: string } => r.familia_id != null
  )
  if (recibosConFamilia.length === 0) return PIVOTE_VACIA

  const reciboIds = recibosConFamilia.map((r) => r.id)
  const familiaIds = [...new Set(recibosConFamilia.map((r) => r.familia_id))]

  const [lineasRes, familiasRes, tutoresRes, conceptosRes] = await Promise.all([
    supabase
      .from('lineas_recibo')
      .select('recibo_id, concepto_id, descripcion, importe_centimos')
      .in('recibo_id', reciboIds),
    supabase.from('familias').select('id, etiqueta').in('id', familiaIds),
    supabase
      .from('familia_tutores')
      .select('familia_id, rol_familia, nombre_completo, usuario:usuarios(nombre_completo)')
      .in('familia_id', familiaIds)
      .is('deleted_at', null),
    supabase.from('conceptos_cobro').select('id, nombre').eq('centro_id', centroId),
  ])

  // Reusamos el slot `ninoId` del builder como `familia_id`. La columna «tutor» = etiqueta
  // de familia; la columna «niño» = tutores de la familia (una sola cadena por familia).
  const etiquetaPorFamilia = new Map((familiasRes.data ?? []).map((f) => [f.id, f.etiqueta]))
  const tutoresPorFamilia = new Map<string, string[]>()
  for (const tr of tutoresRes.data ?? []) {
    const nombre = tr.nombre_completo ?? tr.usuario?.nombre_completo ?? ''
    if (!nombre) continue
    const actual = tutoresPorFamilia.get(tr.familia_id) ?? []
    if (tr.rol_familia === 'titular') actual.unshift(nombre)
    else actual.push(nombre)
    tutoresPorFamilia.set(tr.familia_id, actual)
  }

  const familiaLabel = new Map(familiaIds.map((id) => [id, etiquetaPorFamilia.get(id) ?? '']))
  const tutoresLabel = new Map(
    familiaIds.map((id) => [id, (tutoresPorFamilia.get(id) ?? []).join(' · ')])
  )
  const conceptoNombre = new Map((conceptosRes.data ?? []).map((c) => [c.id, c.nombre]))

  const recibosInput: ReciboPivoteInput[] = recibosConFamilia.map((r) => ({
    id: r.id,
    ninoId: r.familia_id, // slot reutilizado como familia_id
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
    tutorNombre: familiaLabel, // columna «tutor» = etiqueta de familia
    ninoNombre: tutoresLabel, // columna «niño» = tutores de la familia
    conceptoNombre,
  })
}
