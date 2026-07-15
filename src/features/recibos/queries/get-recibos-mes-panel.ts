import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import {
  construirPanelFamilia,
  type FamiliaPanelInput,
  type LineaPanelInput,
  type PanelRecibosMes,
  type ReciboPanelInput,
} from '../lib/panel-familia'

type EstadoRecibo = Database['public']['Enums']['estado_recibo']
type MetodoPago = Database['public']['Enums']['metodo_pago']

export interface PanelMesData extends PanelRecibosMes {
  cerrado: boolean
  cerradoAt: string | null
  esporadicos: EsporadicoResumen[]
  /** Método preferido por familia/mes (metodo_pago_familia); refleja el selector aun sin recibo. */
  metodoPreferencia: Record<string, MetodoPago>
}

/** Recibos esporádicos / re-giros del mes (nacen confirmados; read-only en el panel). */
export interface EsporadicoResumen {
  id: string
  familiaId: string | null
  familiaEtiqueta: string
  concepto: string | null
  estado: EstadoRecibo
  metodo: MetodoPago | null
  totalCentimos: number
  esRegiro: boolean
}

const VACIO: PanelMesData = {
  filas: [],
  indicadores: { numRecibos: 0, confirmados: 0, pendientes: 0, totalCentimos: 0, familiasSinRecibo: 0 },
  cerrado: false,
  cerradoAt: null,
  esporadicos: [],
  metodoPreferencia: {},
}

/**
 * Datos del PANEL DEL MES (F-4-4) a grano FAMILIA: por cada familia con hijos activos,
 * su recibo regular del mes (borrador/confirmado) y el desglose de líneas; más las
 * familias SIN recibo (para cazar olvidos) y los esporádicos/re-giros del mes. RLS:
 * solo admin del centro ve recibos/líneas. Las tablas B-0 se tiparon a mano sin
 * `Relationships` (los embeds no tipan) → se traen por separado y se une en memoria.
 */
export async function getRecibosMesPanel(
  centroId: string,
  anio: number,
  mes: number
): Promise<PanelMesData> {
  const supabase = await createClient()

  // Familias con al menos un niño activo del centro + sus hijos.
  const { data: ninosRows, error: ninosErr } = await supabase
    .from('ninos')
    .select('id, nombre, apellidos, familia_id, matriculas!inner(estado, fecha_baja, deleted_at)')
    .eq('centro_id', centroId)
    .eq('matriculas.estado', 'activa')
    .is('matriculas.fecha_baja', null)
    .is('matriculas.deleted_at', null)
    .is('deleted_at', null)

  if (ninosErr) {
    logger.warn('getRecibosMesPanel: ninos', ninosErr.message)
    return VACIO
  }
  const ninos = ninosRows ?? []
  if (ninos.length === 0) {
    return { ...VACIO, ...(await soloCierre(supabase, centroId, anio, mes)) }
  }

  const familiaIds = [...new Set(ninos.map((n) => n.familia_id).filter((x): x is string => x != null))]

  const [familiasRes, tutoresRes, recibosRes, cierreRes, metodosRes] = await Promise.all([
    supabase.from('familias').select('id, etiqueta').in('id', familiaIds),
    supabase
      .from('familia_tutores')
      .select('familia_id, rol_familia, nombre_completo, usuario:usuarios(nombre_completo)')
      .in('familia_id', familiaIds)
      .is('deleted_at', null),
    supabase
      .from('recibos')
      .select('id, familia_id, nino_id, estado, metodo, total_centimos, es_esporadico, concepto_esporadico, devuelto_de_recibo_id')
      .eq('centro_id', centroId)
      .eq('anio', anio)
      .eq('mes', mes)
      .is('deleted_at', null),
    supabase
      .from('cierre_mensual')
      .select('cerrado_at')
      .eq('centro_id', centroId)
      .eq('anio', anio)
      .eq('mes', mes)
      .maybeSingle(),
    supabase
      .from('metodo_pago_familia')
      .select('familia_id, metodo')
      .eq('centro_id', centroId)
      .eq('anio', anio)
      .eq('mes', mes)
      .is('deleted_at', null),
  ])

  const metodoPreferencia: Record<string, MetodoPago> = {}
  for (const m of metodosRes.data ?? []) metodoPreferencia[m.familia_id] = m.metodo

  const etiquetaPorFamilia = new Map((familiasRes.data ?? []).map((f) => [f.id, f.etiqueta]))
  const tutoresPorFamilia = new Map<string, string[]>()
  for (const tRow of tutoresRes.data ?? []) {
    const nombre = tRow.nombre_completo ?? tRow.usuario?.nombre_completo ?? ''
    if (!nombre) continue
    const actual = tutoresPorFamilia.get(tRow.familia_id) ?? []
    // Titular primero (orden estable para render).
    if (tRow.rol_familia === 'titular') actual.unshift(nombre)
    else actual.push(nombre)
    tutoresPorFamilia.set(tRow.familia_id, actual)
  }

  const hijosPorFamilia = new Map<string, Array<{ ninoId: string; nombre: string }>>()
  for (const n of ninos) {
    if (!n.familia_id) continue
    const actual = hijosPorFamilia.get(n.familia_id) ?? []
    actual.push({ ninoId: n.id, nombre: [n.nombre, n.apellidos].filter(Boolean).join(' ') })
    hijosPorFamilia.set(n.familia_id, actual)
  }

  const familias: FamiliaPanelInput[] = familiaIds.map((id) => ({
    familiaId: id,
    etiqueta: etiquetaPorFamilia.get(id) ?? '',
    tutores: tutoresPorFamilia.get(id) ?? [],
    hijos: hijosPorFamilia.get(id) ?? [],
  }))

  const recibos = recibosRes.data ?? []
  const regulares = recibos.filter((r) => !r.es_esporadico && r.devuelto_de_recibo_id == null)
  const esporadicosRaw = recibos.filter((r) => r.es_esporadico || r.devuelto_de_recibo_id != null)

  const recibosInput: ReciboPanelInput[] = regulares
    .filter((r): r is typeof r & { familia_id: string } => r.familia_id != null)
    .map((r) => ({
      id: r.id,
      familiaId: r.familia_id,
      estado: r.estado,
      metodo: r.metodo,
      totalCentimos: r.total_centimos,
    }))

  const reciboRegularIds = recibosInput.map((r) => r.id)
  const { data: lineasRows } =
    reciboRegularIds.length > 0
      ? await supabase
          .from('lineas_recibo')
          .select('id, recibo_id, nino_id, concepto_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos')
          .in('recibo_id', reciboRegularIds)
      : { data: [] }

  const lineasInput: LineaPanelInput[] = (lineasRows ?? []).map((l) => ({
    id: l.id,
    reciboId: l.recibo_id,
    ninoId: l.nino_id,
    conceptoId: l.concepto_id,
    descripcion: l.descripcion,
    cantidad: l.cantidad,
    precioUnitarioCentimos: l.precio_unitario_centimos,
    importeCentimos: l.importe_centimos,
  }))

  const panel = construirPanelFamilia(familias, recibosInput, lineasInput)

  const esporadicos: EsporadicoResumen[] = esporadicosRaw
    .map((r) => ({
      id: r.id,
      familiaId: r.familia_id,
      familiaEtiqueta: r.familia_id ? (etiquetaPorFamilia.get(r.familia_id) ?? '') : '',
      concepto: r.concepto_esporadico,
      estado: r.estado,
      metodo: r.metodo,
      totalCentimos: r.total_centimos,
      esRegiro: r.devuelto_de_recibo_id != null,
    }))
    .sort((a, b) => a.familiaEtiqueta.localeCompare(b.familiaEtiqueta, 'es-ES'))

  return {
    ...panel,
    cerrado: cierreRes.data != null,
    cerradoAt: cierreRes.data?.cerrado_at ?? null,
    esporadicos,
    metodoPreferencia,
  }
}

async function soloCierre(
  supabase: Awaited<ReturnType<typeof createClient>>,
  centroId: string,
  anio: number,
  mes: number
): Promise<{ cerrado: boolean; cerradoAt: string | null }> {
  const { data } = await supabase
    .from('cierre_mensual')
    .select('cerrado_at')
    .eq('centro_id', centroId)
    .eq('anio', anio)
    .eq('mes', mes)
    .maybeSingle()
  return { cerrado: data != null, cerradoAt: data?.cerrado_at ?? null }
}
