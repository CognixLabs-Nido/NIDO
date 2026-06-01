import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { EventoCalendario } from '../types'

const COLS =
  'id, ambito, tipo, titulo, descripcion, lugar, fecha, fecha_fin, hora_inicio, hora_fin, requiere_confirmacion, estado, aula_id, nino_id'

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Eventos visibles para el usuario (RLS) que **solapan** el grid del mes
 * (anio/mes 1-12). Rango ampliado ±10 días para cubrir las 42 celdas del
 * `<CalendarioMensual/>` sin un round-trip extra (mismo criterio que
 * `getCalendarioMes` de F4.5a).
 *
 * Solape: empieza antes del fin del grid (`fecha <= hasta`) y termina en/después
 * del inicio (`fecha >= desde` para día único, o `fecha_fin >= desde` para rango).
 */
export async function getEventosMes(
  centroId: string,
  anio: number,
  mes: number
): Promise<EventoCalendario[]> {
  const supabase = await createClient()

  const desdeD = new Date(anio, mes - 1, 1)
  desdeD.setDate(desdeD.getDate() - 10)
  const hastaD = new Date(anio, mes, 0)
  hastaD.setDate(hastaD.getDate() + 10)
  const desde = ymd(desdeD)
  const hasta = ymd(hastaD)

  const { data, error } = await supabase
    .from('eventos')
    .select(COLS)
    .eq('centro_id', centroId)
    .lte('fecha', hasta)
    .or(`fecha.gte.${desde},fecha_fin.gte.${desde}`)
    .order('fecha', { ascending: true })

  if (error) {
    logger.warn('getEventosMes failed', error.message)
    return []
  }

  return (data ?? []) as EventoCalendario[]
}
