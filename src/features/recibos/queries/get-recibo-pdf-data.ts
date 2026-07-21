import 'server-only'

import {
  agruparLineasPorHijo,
  type LineaConNino,
} from '@/features/recibos/lib/recibo-familia-detalle'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/database'

type EstadoRecibo = Database['public']['Enums']['estado_recibo']
type MetodoPago = Database['public']['Enums']['metodo_pago']

export interface ReciboParaPdf {
  centroNombre: string
  /** Logo del centro (`centros.logo_url`); `null` si no tiene → el PDF va sin logo. */
  centroLogoUrl: string | null
  anio: number
  mes: number
  estado: EstadoRecibo
  metodo: MetodoPago | null
  esEsporadico: boolean
  conceptoEsporadico: string | null
  totalCentimos: number
  fechaEnvioBanco: string | null
  fechaDevolucion: string | null
  /** Grupos por hijo + bloque familiar; `descripcion` ya limpia (concepto sin el nombre). */
  gruposHijo: ReturnType<typeof agruparLineasPorHijo>['gruposHijo']
  lineasFamiliares: ReturnType<typeof agruparLineasPorHijo>['lineasFamiliares']
  subtotalFamiliarCentimos: number
}

/** Quita el nombre embebido del niño (" · Pepe") de la descripción cruda del motor. */
function limpiarNombreEmbebido(descripcion: string, primerNombre: string | null): string {
  if (!primerNombre) return descripcion
  return descripcion.replaceAll(` · ${primerNombre}`, '').trim()
}

/**
 * Datos de UN recibo familiar para su PDF (B4). La AUTORIZACIÓN es idéntica a la pantalla
 * del portal (`getReciboFamiliaDetalle`): se lee `recibos` con el cliente del usuario (RLS
 * `es_tutor_de_familia`) y se excluye el borrador → `null` si no es visible. No se relaja
 * nada: un tutor solo obtiene datos de SUS recibos.
 *
 * A diferencia de la query del portal, además trae el `concepto_id` de cada línea para
 * mostrar el nombre LIMPIO del concepto (sin el nombre del niño embebido en `descripcion`).
 * El nombre del concepto y del centro se resuelven con service role (ya autorizado; el
 * catálogo de conceptos puede no ser legible por el tutor), espejo de `assembleInformePdfData`.
 */
export async function getReciboParaPdf(reciboId: string): Promise<ReciboParaPdf | null> {
  const supabase = await createClient()

  const { data: recibo, error } = await supabase
    .from('recibos')
    .select(
      'id, centro_id, anio, mes, estado, metodo, total_centimos, es_esporadico, concepto_esporadico, devuelto_de_recibo_id, fecha_envio_banco, fecha_devolucion'
    )
    .eq('id', reciboId)
    .neq('estado', 'borrador')
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    logger.warn('getReciboParaPdf: recibo', error.message)
    return null
  }
  if (!recibo) return null

  const { data: lineas } = await supabase
    .from('lineas_recibo')
    .select(
      'id, nino_id, concepto_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos'
    )
    .eq('recibo_id', reciboId)
    .order('created_at', { ascending: true })

  // Nombres de los hijos con línea (RLS del usuario: ve a sus hijos).
  const ninoIds = [
    ...new Set((lineas ?? []).map((l) => l.nino_id).filter((id): id is string => id != null)),
  ]
  const nombrePorNino = new Map<string, string>()
  if (ninoIds.length > 0) {
    const { data: ninos } = await supabase
      .from('ninos')
      .select('id, nombre, apellidos')
      .in('id', ninoIds)
    for (const n of ninos ?? []) {
      nombrePorNino.set(n.id, [n.nombre, n.apellidos].filter(Boolean).join(' '))
    }
  }

  // Nombre limpio del concepto + nombre del centro con service role (ya autorizado).
  const service = createServiceRoleClient()
  const conceptoIds = [
    ...new Set((lineas ?? []).map((l) => l.concepto_id).filter((id): id is string => id != null)),
  ]
  const nombreConcepto = new Map<string, string>()
  if (conceptoIds.length > 0) {
    const { data: conceptos } = await service
      .from('conceptos_cobro')
      .select('id, nombre')
      .in('id', conceptoIds)
    for (const c of conceptos ?? []) nombreConcepto.set(c.id, c.nombre)
  }
  const { data: centro } = await service
    .from('centros')
    .select('nombre, logo_url')
    .eq('id', recibo.centro_id)
    .maybeSingle()

  // Etiqueta limpia por línea: concepto del catálogo si hay concepto_id; si no, la
  // descripción cruda sin el nombre del niño embebido (becas / saldo).
  const lineasConNino: LineaConNino[] = (lineas ?? []).map((l) => {
    const primerNombre = l.nino_id ? (nombrePorNino.get(l.nino_id)?.split(' ')[0] ?? null) : null
    const etiqueta = l.concepto_id
      ? (nombreConcepto.get(l.concepto_id) ?? limpiarNombreEmbebido(l.descripcion, primerNombre))
      : limpiarNombreEmbebido(l.descripcion, primerNombre)
    return {
      id: l.id,
      ninoId: l.nino_id,
      descripcion: etiqueta,
      cantidad: l.cantidad,
      precioUnitarioCentimos: l.precio_unitario_centimos,
      importeCentimos: l.importe_centimos,
    }
  })

  const desglose = agruparLineasPorHijo(lineasConNino, nombrePorNino)

  return {
    centroNombre: centro?.nombre ?? '',
    centroLogoUrl: centro?.logo_url ?? null,
    anio: recibo.anio,
    mes: recibo.mes,
    estado: recibo.estado,
    metodo: recibo.metodo,
    esEsporadico: recibo.es_esporadico,
    conceptoEsporadico: recibo.concepto_esporadico,
    totalCentimos: recibo.total_centimos,
    fechaEnvioBanco: recibo.fecha_envio_banco,
    fechaDevolucion: recibo.fecha_devolucion,
    gruposHijo: desglose.gruposHijo,
    lineasFamiliares: desglose.lineasFamiliares,
    subtotalFamiliarCentimos: desglose.subtotalFamiliarCentimos,
  }
}
