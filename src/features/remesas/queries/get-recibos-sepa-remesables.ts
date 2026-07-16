import 'server-only'

import { createClient } from '@/lib/supabase/server'

export interface ReciboSepaRemesable {
  /** id del RECIBO (1 recibo = 1 adeudo pain.008; endToEndId = recibo_id). */
  id: string
  familiaId: string
  familiaEtiqueta: string
  /** Tutores de la familia (titular primero). */
  tutores: string[]
  totalCentimos: number
  esEsporadico: boolean
  /**
   * ¿La FAMILIA del recibo tiene un mandato SEPA activo? (F-2c-1: el mandato es de la
   * familia). Si no, no puede entrar a la remesa (el generador la rechazaría).
   */
  tieneMandato: boolean
}

/** Fila mínima de recibo SEPA remesable (para el ensamblado puro/testeable). */
export interface ReciboSepaRow {
  id: string
  familiaId: string
  totalCentimos: number
  esEsporadico: boolean
}

/**
 * Ensambla los remesables a grano FAMILIA (puro: la parte Supabase queda en la query).
 * Excluye los ya enlazados a una remesa; adjunta etiqueta + tutores de la familia y si
 * la familia tiene mandato activo. Ordena por etiqueta de familia (es-ES).
 */
export function ensamblarRemesables(
  recibos: ReciboSepaRow[],
  remesados: Set<string>,
  familiasConMandato: Set<string>,
  etiquetaPorFamilia: Map<string, string>,
  tutoresPorFamilia: Map<string, string[]>
): ReciboSepaRemesable[] {
  return recibos
    .filter((r) => !remesados.has(r.id))
    .map((r) => ({
      id: r.id,
      familiaId: r.familiaId,
      familiaEtiqueta: etiquetaPorFamilia.get(r.familiaId) ?? '',
      tutores: tutoresPorFamilia.get(r.familiaId) ?? [],
      totalCentimos: r.totalCentimos,
      esEsporadico: r.esEsporadico,
      tieneMandato: familiasConMandato.has(r.familiaId),
    }))
    .sort(
      (a, b) =>
        a.familiaEtiqueta.localeCompare(b.familiaEtiqueta, 'es-ES') || a.id.localeCompare(b.id)
    )
}

/**
 * Recibos de método 'sepa' CONFIRMADOS y aún no enviados (estado='pendiente_procesar')
 * del periodo, a grano FAMILIA, que aún no están en ninguna remesa. Base para el marcado
 * de la remesa por la directora. RLS: solo admin del centro. Excluye importes ≤ 0.
 *
 * Gate `estado = 'pendiente_procesar'` (corte ESTRICTO): solo se remesan los confirmados
 * aún no enviados. Un BORRADOR nunca se remesa; `enviado_banco/devuelto/cobrado_manual`
 * tampoco vuelven a entrar. (La RPC get_mandatos_remesa usa `IN (pendiente_procesar,
 * enviado_banco)` porque allí es una red sobre enlaces YA creados y debe permitir la
 * re-descarga del XML de una remesa enviada — distinción documentada en su migración.)
 */
export async function getRecibosSepaRemesables(
  centroId: string,
  anio: number,
  mes: number
): Promise<ReciboSepaRemesable[]> {
  const supabase = await createClient()

  const { data: recibos } = await supabase
    .from('recibos')
    .select('id, familia_id, total_centimos, es_esporadico')
    .eq('centro_id', centroId)
    .eq('anio', anio)
    .eq('mes', mes)
    .eq('metodo', 'sepa')
    .eq('estado', 'pendiente_procesar')
    .is('deleted_at', null)
    .gt('total_centimos', 0)

  if (!recibos || recibos.length === 0) return []

  // F-4-5: grano familia — se lee recibos.familia_id DIRECTO (sin puente por niño).
  const conFamilia = recibos.filter(
    (r): r is typeof r & { familia_id: string } => r.familia_id != null
  )
  if (conFamilia.length === 0) return []

  const familiaIds = [...new Set(conFamilia.map((r) => r.familia_id))]

  const [{ data: yaEnRemesa }, { data: mandatos }, { data: familias }, { data: tutores }] =
    await Promise.all([
      supabase.from('recibos_remesa').select('recibo_id').eq('centro_id', centroId),
      supabase
        .from('mandatos_sepa')
        .select('familia_id')
        .eq('centro_id', centroId)
        .eq('estado', 'activo')
        .is('deleted_at', null),
      supabase.from('familias').select('id, etiqueta').in('id', familiaIds),
      supabase
        .from('familia_tutores')
        .select('familia_id, rol_familia, nombre_completo, usuario:usuarios(nombre_completo)')
        .in('familia_id', familiaIds)
        .is('deleted_at', null),
    ])

  const remesados = new Set((yaEnRemesa ?? []).map((r) => r.recibo_id))
  const familiasConMandato = new Set(
    (mandatos ?? []).map((m) => m.familia_id).filter((f): f is string => f != null)
  )
  const etiquetaPorFamilia = new Map((familias ?? []).map((f) => [f.id, f.etiqueta]))

  const tutoresPorFamilia = new Map<string, string[]>()
  for (const tr of tutores ?? []) {
    const nombre = tr.nombre_completo ?? tr.usuario?.nombre_completo ?? ''
    if (!nombre) continue
    const actual = tutoresPorFamilia.get(tr.familia_id) ?? []
    if (tr.rol_familia === 'titular') actual.unshift(nombre)
    else actual.push(nombre)
    tutoresPorFamilia.set(tr.familia_id, actual)
  }

  const rows: ReciboSepaRow[] = conFamilia.map((r) => ({
    id: r.id,
    familiaId: r.familia_id,
    totalCentimos: r.total_centimos,
    esEsporadico: r.es_esporadico,
  }))

  return ensamblarRemesables(rows, remesados, familiasConMandato, etiquetaPorFamilia, tutoresPorFamilia)
}
