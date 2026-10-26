import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { origenExceso } from '@/features/beca-comedor/lib/origen-exceso'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

import {
  construirHistorial,
  type EnlaceRemesaInput,
  type LineaEnlazadaInput,
  type ReciboHistorial,
  type ReciboHistorialInput,
  type SobranteChequeInput,
} from '../lib/historial-familia'

/** Las columnas de `recibos` que lee el histórico (las de `ReciboHistorialInput`). */
export const COLUMNAS_RECIBO_HISTORIAL =
  'id, familia_id, anio, mes, estado, metodo, total_centimos, es_esporadico, concepto_esporadico, devuelto_de_recibo_id, diferencia_de_recibo_id, fecha_envio_banco, fecha_devolucion, devolucion_gastos_centimos, devolucion_salida, cobro_forma, cobro_fecha, cobro_nota, cobro_importe_centimos, created_at'

const COLUMNAS_LINEA = 'recibo_id, importe_centimos, arrastre_de_recibo_id, sobrante_de_desborde_id'

type Cliente = SupabaseClient<Database>
type LineaRow = {
  recibo_id: string
  importe_centimos: number
  arrastre_de_recibo_id: string | null
  sobrante_de_desborde_id: string | null
}
type DesbordeRow = Database['public']['Tables']['beca_comedor_desborde']['Row']

/**
 * Lo que pasó al cobrar cada recibo de `recibos` (F-6), en su orden. La ficha de la familia le pasa
 * todos los de la familia; el histórico general, una página. Por eso los enlaces se buscan fuera de
 * lo recibido: el recibo del que nace un re-giro o una diferencia, el re-giro o la diferencia que
 * nacen de él, adónde se llevó su devolución o su sobrante y de dónde viene lo que trae. Se leen solo
 * esos recibos, por sus índices, y se devuelven solo los recibidos.
 *
 * `null` si alguna lectura falla: quien llama lo dice, no lo convierte en «sin recibos».
 */
export async function enriquecerHistorial(
  supabase: Cliente,
  centroId: string,
  recibos: ReciboHistorialInput[]
): Promise<ReciboHistorial[] | null> {
  if (recibos.length === 0) return []
  const ids = recibos.map((r) => r.id)
  const origenes = uniq(
    recibos.flatMap((r) => [r.devuelto_de_recibo_id, r.diferencia_de_recibo_id])
  ).filter((id) => !ids.includes(id))

  // 1. Todo lo que cuelga de los recibos recibidos.
  const [inversos, origenRows, lineasPropias, lineasLlevadas, sobrantesPropios, enlacesRes] =
    await Promise.all([
      // El re-giro y la diferencia que nacen de ellos.
      supabase
        .from('recibos')
        .select(COLUMNAS_RECIBO_HISTORIAL)
        .eq('centro_id', centroId)
        .is('deleted_at', null)
        .or(`devuelto_de_recibo_id.in.(${ids}),diferencia_de_recibo_id.in.(${ids})`),
      // El recibo del que nacen.
      origenes.length === 0
        ? vacio<ReciboHistorialInput>()
        : supabase
            .from('recibos')
            .select(COLUMNAS_RECIBO_HISTORIAL)
            .eq('centro_id', centroId)
            .is('deleted_at', null)
            .in('id', origenes),
      // Lo que traen de otro recibo: una devolución arrastrada o un sobrante diferido.
      supabase
        .from('lineas_recibo')
        .select(COLUMNAS_LINEA)
        .eq('centro_id', centroId)
        .in('recibo_id', ids)
        .or('arrastre_de_recibo_id.not.is.null,sobrante_de_desborde_id.not.is.null'),
      // Su devolución, llevada a otro recibo.
      supabase
        .from('lineas_recibo')
        .select(COLUMNAS_LINEA)
        .eq('centro_id', centroId)
        .in('arrastre_de_recibo_id', ids),
      // `*` para leer el origen también antes de que exista la columna (como `getRecibosGestion`).
      supabase
        .from('beca_comedor_desborde')
        .select('*')
        .eq('centro_id', centroId)
        .in('recibo_id', ids),
      supabase
        .from('recibos_remesa')
        .select('recibo_id, remesa_id')
        .eq('centro_id', centroId)
        .in('recibo_id', ids),
    ])
  const fallo1 =
    inversos.error ??
    origenRows.error ??
    lineasPropias.error ??
    lineasLlevadas.error ??
    sobrantesPropios.error ??
    enlacesRes.error
  if (fallo1) return fallar('lecturas', fallo1.message)

  const sobrantesSuyos = (sobrantesPropios.data ?? []).filter(esCheque)
  // Los sobrantes que traen sus líneas (de un cheque de otro recibo) y las líneas de los suyos.
  const sobrantesQueTraen = uniq(
    (lineasPropias.data ?? []).map((l) => l.sobrante_de_desborde_id)
  ).filter((id) => !sobrantesSuyos.some((s) => s.id === id))
  const enlaces = enlacesRes.data ?? []
  const remesaIds = uniq(enlaces.map((e) => e.remesa_id))

  // 2. Los sobrantes de otros recibos, adónde se difirieron los suyos y las remesas vivas.
  const [sobrantesAjenos, lineasDiferidas, remesasRes] = await Promise.all([
    sobrantesQueTraen.length === 0
      ? vacio<DesbordeRow>()
      : supabase
          .from('beca_comedor_desborde')
          .select('*')
          .eq('centro_id', centroId)
          .in('id', sobrantesQueTraen),
    sobrantesSuyos.length === 0
      ? vacio<LineaRow>()
      : supabase
          .from('lineas_recibo')
          .select(COLUMNAS_LINEA)
          .eq('centro_id', centroId)
          .in(
            'sobrante_de_desborde_id',
            sobrantesSuyos.map((s) => s.id)
          ),
    remesaIds.length === 0
      ? vacio<{ id: string; anio: number; mes: number; estado: 'borrador' | 'enviada' }>()
      : supabase
          .from('remesas')
          .select('id, anio, mes, estado')
          .eq('centro_id', centroId)
          .in('id', remesaIds)
          .is('deleted_at', null),
  ])
  const fallo2 = sobrantesAjenos.error ?? lineasDiferidas.error ?? remesasRes.error
  if (fallo2) return fallar('enlaces', fallo2.message)

  // 3. Los recibos de los que vienen o a los que fue el dinero y que aún no están.
  const cargados = new Map<string, ReciboHistorialInput>()
  for (const r of [...recibos, ...(inversos.data ?? []), ...(origenRows.data ?? [])]) {
    cargados.set(r.id, r)
  }
  const sobrantes = [...sobrantesSuyos, ...(sobrantesAjenos.data ?? []).filter(esCheque)]
  const lineas: LineaRow[] = [
    ...(lineasPropias.data ?? []),
    ...(lineasLlevadas.data ?? []),
    ...(lineasDiferidas.data ?? []),
  ]
  const faltan = uniq([
    ...lineas.map((l) => l.recibo_id),
    ...lineas.map((l) => l.arrastre_de_recibo_id),
    ...sobrantes.map((s) => s.recibo_id),
  ]).filter((id) => !cargados.has(id))
  if (faltan.length > 0) {
    const { data, error } = await supabase
      .from('recibos')
      .select(COLUMNAS_RECIBO_HISTORIAL)
      .eq('centro_id', centroId)
      .is('deleted_at', null)
      .in('id', faltan)
    if (error) return fallar('relacionados', error.message)
    for (const r of data ?? []) cargados.set(r.id, r)
  }

  const remesaPorId = new Map((remesasRes.data ?? []).map((r) => [r.id, r]))
  const enlacesRemesa: EnlaceRemesaInput[] = enlaces.flatMap((e) => {
    const r = remesaPorId.get(e.remesa_id)
    return r ? [{ reciboId: e.recibo_id, anio: r.anio, mes: r.mes, estado: r.estado }] : []
  })
  const lineasEnlazadas: LineaEnlazadaInput[] = uniqPor(lineas, (l) =>
    [l.recibo_id, l.arrastre_de_recibo_id, l.sobrante_de_desborde_id].join(':')
  ).map((l) => ({
    reciboId: l.recibo_id,
    importeCentimos: l.importe_centimos,
    arrastreDeReciboId: l.arrastre_de_recibo_id,
    sobranteDeDesbordeId: l.sobrante_de_desborde_id,
  }))
  const sobrantesInput: SobranteChequeInput[] = uniqPor(sobrantes, (s) => s.id).map((s) => ({
    id: s.id,
    reciboId: s.recibo_id,
    excesoCentimos: s.exceso_centimos,
    estado: s.estado,
    via: s.via,
  }))

  const porId = new Map(
    construirHistorial({
      recibos: [...cargados.values()],
      enlacesRemesa,
      lineasEnlazadas,
      sobrantes: sobrantesInput,
    }).map((h) => [h.id, h])
  )
  return ids.map((id) => porId.get(id)!)
}

/** Solo el sobrante de un cheque: el desborde de beca no es un cobro. */
function esCheque(d: DesbordeRow): boolean {
  return origenExceso(d) === 'cheque'
}

function uniq(valores: Array<string | null>): string[] {
  return [...new Set(valores.filter((v): v is string => v != null))]
}

function uniqPor<T>(filas: T[], clave: (f: T) => string): T[] {
  const vistos = new Map<string, T>()
  for (const f of filas) if (!vistos.has(clave(f))) vistos.set(clave(f), f)
  return [...vistos.values()]
}

function vacio<T>(): Promise<{ data: T[]; error: null }> {
  return Promise.resolve({ data: [], error: null })
}

function fallar(paso: string, mensaje: string): null {
  logger.warn(`enriquecerHistorial ${paso}`, mensaje)
  return null
}
