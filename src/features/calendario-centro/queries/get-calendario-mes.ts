import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { OverrideMes } from '../types'

/**
 * Devuelve los overrides persistidos en `dias_centro` para el mes
 * (anio/mes 1-12) del centro. La query se hace contra el rango ampliado
 * que cubre el grid completo (lunes anterior al día 1 hasta domingo
 * siguiente al último día), porque el grid muestra 42 celdas y queremos
 * resolver el tipo de las celdas overflow sin un round-trip extra.
 *
 * No incluye el cálculo de tipos default — eso lo hace el cliente con
 * `tipoDefaultDeFecha` para evitar 42 invocaciones a `tipo_de_dia` desde
 * el server.
 */
export async function getCalendarioMes(
  centroId: string,
  anio: number,
  mes: number
): Promise<OverrideMes[]> {
  const supabase = await createClient()

  // Rango ampliado para cubrir el grid 7×6. Lunes anterior al día 1 puede
  // ser hasta 6 días antes (si día 1 es domingo). Domingo siguiente al
  // último día puede ser hasta 6 días después. 7 + 7 = 14 días de holgura
  // total. Simplemente ampliamos 10 días por cada lado.
  const desde = new Date(anio, mes - 1, 1)
  desde.setDate(desde.getDate() - 10)
  const hasta = new Date(anio, mes, 0)
  hasta.setDate(hasta.getDate() + 10)

  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  const { data, error } = await supabase
    .from('dias_centro')
    .select('fecha, tipo, observaciones')
    .eq('centro_id', centroId)
    .gte('fecha', ymd(desde))
    .lte('fecha', ymd(hasta))
    .order('fecha', { ascending: true })

  if (error) {
    logger.warn('getCalendarioMes failed', error.message)
    return []
  }

  return (data ?? []).map((d) => ({
    fecha: d.fecha,
    tipo: d.tipo,
    observaciones: d.observaciones,
  }))
}
