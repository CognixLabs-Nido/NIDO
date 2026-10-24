import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import { mesesDelCurso } from './cargas'
import {
  construirPanel,
  type AlumnoPanel,
  type DesbordePanel,
  type LineaBecaPanel,
  type PanelBecas,
  type ReciboPanel,
} from './panel-becas'

type Client = SupabaseClient<Database>

/** Ids por petición: un `.in()` largo no cabe en la URL de PostgREST. */
const LOTE = 150

function lotes<T>(xs: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += LOTE) out.push(xs.slice(i, i + LOTE))
  return out
}

/**
 * PR-11 — lee lo que necesita el panel de becas del curso y lo construye. Recibe el cliente
 * (la página pasa el de la sesión de Dirección; el test de RLS, el suyo), así que lee
 * exactamente con la RLS de quien mira: `beca_comedor_*`, `recibos` y `lineas_recibo` son de
 * `es_admin`. Un error de lectura se lanza: el panel no puede salir incompleto sin decirlo.
 */
export async function leerPanelBecas(
  supabase: Client,
  centroId: string,
  curso: { id: string; fecha_inicio: string; fecha_fin: string }
): Promise<PanelBecas> {
  const [tramosRes, eligRes, matsRes] = await Promise.all([
    supabase
      .from('beca_comedor_tramo')
      .select(
        'id, nino_id, anio_correspondiente, mes_correspondiente, anio_aplicacion, mes_aplicacion, importe_centimos, estado, origen, aplicada_en_recibo_id'
      )
      .eq('centro_id', centroId)
      .eq('curso_academico_id', curso.id),
    supabase
      .from('beca_comedor_elegibilidad')
      .select('nino_id')
      .eq('centro_id', centroId)
      .eq('curso_academico_id', curso.id)
      .eq('activa', true),
    supabase
      .from('matriculas')
      .select('nino_id, nino:ninos!inner(centro_id)')
      .eq('nino.centro_id', centroId)
      .eq('curso_academico_id', curso.id)
      .eq('estado', 'activa')
      .is('fecha_baja', null)
      .is('deleted_at', null),
  ])
  for (const r of [tramosRes, eligRes, matsRes]) {
    if (r.error) throw new Error(`leerPanelBecas: ${r.error.message}`)
  }
  const tramos = tramosRes.data ?? []
  const becados = new Set((eligRes.data ?? []).map((e) => e.nino_id))
  const matriculados = new Set((matsRes.data ?? []).map((m) => m.nino_id))

  // Las líneas de beca de esos tramos y sus recibos (vivos y regulares, como los del motor).
  const lineas: LineaBecaPanel[] = []
  const recibos = new Map<string, ReciboPanel>()
  for (const ids of lotes(tramos.map((t) => t.id))) {
    const { data, error } = await supabase
      .from('lineas_recibo')
      .select(
        'beca_tramo_id, recibo:recibos!inner(id, estado, anio, mes, es_esporadico, devuelto_de_recibo_id, deleted_at)'
      )
      .eq('centro_id', centroId)
      .in('beca_tramo_id', ids)
    if (error) throw new Error(`leerPanelBecas lineas: ${error.message}`)
    for (const l of data ?? []) {
      const r = l.recibo
      if (!l.beca_tramo_id || r.es_esporadico || r.devuelto_de_recibo_id || r.deleted_at) continue
      lineas.push({ beca_tramo_id: l.beca_tramo_id, recibo_id: r.id })
      recibos.set(r.id, { id: r.id, estado: r.estado, anio: r.anio, mes: r.mes })
    }
  }
  // El recibo sellado de un tramo aplicado, por si su línea no se ha leído.
  const sellados = [
    ...new Set(
      tramos.flatMap((t) =>
        t.aplicada_en_recibo_id && !recibos.has(t.aplicada_en_recibo_id)
          ? [t.aplicada_en_recibo_id]
          : []
      )
    ),
  ]
  for (const ids of lotes(sellados)) {
    const { data, error } = await supabase
      .from('recibos')
      .select('id, estado, anio, mes')
      .eq('centro_id', centroId)
      .in('id', ids)
    if (error) throw new Error(`leerPanelBecas recibos: ${error.message}`)
    for (const r of data ?? []) recibos.set(r.id, r)
  }

  const desbordes: DesbordePanel[] = []
  for (const ids of lotes([...recibos.keys()])) {
    const { data, error } = await supabase
      .from('beca_comedor_desborde')
      .select('recibo_id, estado, via, exceso_centimos')
      .eq('centro_id', centroId)
      .in('recibo_id', ids)
    if (error) throw new Error(`leerPanelBecas desbordes: ${error.message}`)
    desbordes.push(...(data ?? []))
  }

  const ninoIds = [...new Set([...becados, ...tramos.map((t) => t.nino_id)])]
  const nombres = new Map<string, string>()
  for (const ids of lotes(ninoIds)) {
    const { data, error } = await supabase
      .from('ninos')
      .select('id, nombre, apellidos')
      .eq('centro_id', centroId)
      .in('id', ids)
    if (error) throw new Error(`leerPanelBecas ninos: ${error.message}`)
    for (const n of data ?? []) {
      nombres.set(n.id, [n.nombre, n.apellidos].filter(Boolean).join(' ').trim() || n.nombre)
    }
  }

  const alumnos: AlumnoPanel[] = ninoIds.map((id) => ({
    id,
    nombre: nombres.get(id) ?? '',
    becado: becados.has(id),
    matriculado: matriculados.has(id),
  }))

  return construirPanel({
    meses: mesesDelCurso(curso.fecha_inicio, curso.fecha_fin),
    alumnos,
    tramos,
    lineas,
    recibos: [...recibos.values()],
    desbordes,
  })
}
