import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/db'

import { leerTarjetasSanitarias } from '../lib/tarjeta-sanitaria'

export interface NinoSinTarjeta {
  id: string
  nombre: string
  apellidos: string | null
}

/**
 * Fase 7 (decidido el 2026-11-13): la tarjeta sanitaria es obligatoria al cerrar el alta, pero no es
 * retroactiva. Los niños ya matriculados (matrícula activa) que no la tienen, para que la Dirección
 * se la reclame a su familia. Un dato que nadie echa de menos no se consigue nunca.
 *
 * `null` si algo no se lee: una lista vacía diría «todos la tienen».
 */
export async function getNinosSinTarjeta(
  supabase: SupabaseClient<Database>,
  centroId: string
): Promise<NinoSinTarjeta[] | null> {
  const { data: mats, error } = await supabase
    .from('matriculas')
    .select('nino_id, ninos!inner(id, nombre, apellidos, centro_id, deleted_at)')
    .eq('estado', 'activa')
    .is('fecha_baja', null)
    .is('deleted_at', null)
    .eq('ninos.centro_id', centroId)
    .is('ninos.deleted_at', null)
  if (error || !mats) {
    logger.warn('getNinosSinTarjeta', error?.code ?? 'sin_respuesta')
    return null
  }
  const ninos = new Map(mats.map((m) => [m.ninos.id, m.ninos]))
  const tarjetas = await leerTarjetasSanitarias(supabase, [...ninos.keys()])
  if (!tarjetas) {
    logger.warn('getNinosSinTarjeta', 'sip_de_ninos no se lee')
    return null
  }
  const sin: NinoSinTarjeta[] = []
  for (const n of ninos.values()) {
    const t = tarjetas.get(n.id)
    // La Dirección del centro recibe todas las filas: una que falta es un fallo, no «sin tarjeta».
    if (!t) return null
    if (!t.sip) sin.push({ id: n.id, nombre: n.nombre, apellidos: n.apellidos })
  }
  return sin.sort((a, b) =>
    `${a.nombre} ${a.apellidos ?? ''}`.localeCompare(`${b.nombre} ${b.apellidos ?? ''}`, 'es')
  )
}
