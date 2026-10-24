import 'server-only'

import { createClient } from '@/lib/supabase/server'

import {
  destinoArrastre,
  ordenarGestion,
  entraEnGestion,
  ESTADOS_GESTION,
  type MesRecibo,
  type ReciboGestion,
  type SalidaDevolucion,
} from '../lib/gestion-cobros'

export type { ReciboGestion } from '../lib/gestion-cobros'

/**
 * Recibos del periodo para la gestión de cobros y devoluciones, a grano FAMILIA: los que esperan
 * un cobro a mano (pendientes que no son SEPA: efectivo, transferencia, cheque, esporádicos y sin
 * método; PR-1a) y los que ya están en el ciclo de cobro (enviado_banco / devuelto /
 * cobrado_manual). Un SEPA pendiente no sale: va por remesa. Con cada recibo, si la familia tiene
 * mandato activo (PR-1b: la diferencia de un cheque solo se pasa al banco con él) y, con cada
 * devolución, el recibo al que se puede arrastrar o al que se arrastró (PR-14). RLS: Dirección.
 */
export async function getRecibosGestion(
  centroId: string,
  anio: number,
  mes: number
): Promise<ReciboGestion[]> {
  const supabase = await createClient()

  const { data: recibos } = await supabase
    .from('recibos')
    .select(
      'id, familia_id, anio, mes, total_centimos, estado, metodo, es_esporadico, concepto_esporadico, fecha_envio_banco, fecha_devolucion, devuelto_de_recibo_id, cobro_forma, cobro_fecha, cobro_nota, cobro_importe_centimos, diferencia_de_recibo_id, devolucion_gastos_centimos, devolucion_salida'
    )
    .eq('centro_id', centroId)
    .eq('anio', anio)
    .eq('mes', mes)
    .in('estado', [...ESTADOS_GESTION])
    .is('deleted_at', null)

  const gestionables = (recibos ?? []).filter(entraEnGestion)
  if (gestionables.length === 0) return []

  const familiaIds = [
    ...new Set(gestionables.map((r) => r.familia_id).filter((x): x is string => x != null)),
  ]
  // PR-14: las devoluciones sin resolver (¿a qué borrador se arrastrarían?) y las arrastradas.
  const porResolver = gestionables.filter(
    (r) => r.estado === 'devuelto' && r.devolucion_salida === null && r.familia_id != null
  )
  const arrastradas = gestionables.filter((r) => r.devolucion_salida === 'siguiente_recibo')

  const [{ data: familias }, { data: mandatos }, { data: borradores }, { data: lineasArrastre }] =
    await Promise.all([
      supabase.from('familias').select('id, etiqueta').in('id', familiaIds),
      // PR-1b: la diferencia de un cheque solo se pasa al banco con mandato activo.
      supabase
        .from('mandatos_sepa')
        .select('familia_id')
        .eq('centro_id', centroId)
        .eq('estado', 'activo')
        .is('deleted_at', null)
        .in('familia_id', familiaIds),
      porResolver.length === 0
        ? Promise.resolve({ data: [] as Array<{ familia_id: string; anio: number; mes: number }> })
        : supabase
            .from('recibos')
            .select('familia_id, anio, mes')
            .eq('centro_id', centroId)
            .in('familia_id', [...new Set(porResolver.map((r) => r.familia_id as string))])
            .eq('estado', 'borrador')
            .eq('es_esporadico', false)
            .is('devuelto_de_recibo_id', null)
            .is('deleted_at', null),
      arrastradas.length === 0
        ? Promise.resolve({
            data: [] as Array<{
              arrastre_de_recibo_id: string | null
              recibo: { anio: number; mes: number }
            }>,
          })
        : supabase
            .from('lineas_recibo')
            .select('arrastre_de_recibo_id, recibo:recibos!recibo_id!inner(anio, mes)')
            .eq('centro_id', centroId)
            .in(
              'arrastre_de_recibo_id',
              arrastradas.map((r) => r.id)
            ),
    ])
  const etiquetaPorFamilia = new Map((familias ?? []).map((f) => [f.id, f.etiqueta]))
  const familiasConMandato = new Set((mandatos ?? []).map((m) => m.familia_id))
  const borradoresPorFamilia = new Map<string, MesRecibo[]>()
  for (const b of borradores ?? []) {
    const lista = borradoresPorFamilia.get(b.familia_id) ?? []
    lista.push({ anio: b.anio, mes: b.mes })
    borradoresPorFamilia.set(b.familia_id, lista)
  }
  const arrastradoA = new Map<string, MesRecibo>()
  for (const l of lineasArrastre ?? []) {
    if (l.arrastre_de_recibo_id) {
      arrastradoA.set(l.arrastre_de_recibo_id, { anio: l.recibo.anio, mes: l.recibo.mes })
    }
  }

  return ordenarGestion(
    gestionables.map((r) => ({
      id: r.id,
      familiaEtiqueta: r.familia_id ? (etiquetaPorFamilia.get(r.familia_id) ?? '') : '',
      totalCentimos: r.total_centimos,
      estado: r.estado,
      metodo: r.metodo,
      esEsporadico: r.es_esporadico,
      conceptoEsporadico: r.concepto_esporadico,
      fechaEnvioBanco: r.fecha_envio_banco,
      fechaDevolucion: r.fecha_devolucion,
      esRegiro: r.devuelto_de_recibo_id != null,
      devolucionGastosCentimos: r.devolucion_gastos_centimos,
      // El CHECK `recibos_devolucion_salida` solo admite las de SALIDAS_DEVOLUCION.
      devolucionSalida: r.devolucion_salida as SalidaDevolucion | null,
      arrastreDisponible:
        r.estado === 'devuelto' && r.devolucion_salida === null && r.familia_id
          ? destinoArrastre(
              { anio: r.anio, mes: r.mes },
              borradoresPorFamilia.get(r.familia_id) ?? []
            )
          : null,
      arrastradoA: arrastradoA.get(r.id) ?? null,
      cobroForma: r.cobro_forma,
      cobroFecha: r.cobro_fecha,
      cobroNota: r.cobro_nota,
      cobroImporteCentimos: r.cobro_importe_centimos,
      esDiferenciaCheque: r.diferencia_de_recibo_id != null,
      familiaConMandato: r.familia_id != null && familiasConMandato.has(r.familia_id),
    }))
  )
}
