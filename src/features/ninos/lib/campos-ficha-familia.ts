import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import { leerFichaGestionDe } from './ficha-gestion'

/**
 * Qué campos de la fase 5 enseña la ficha del niño en la familia (decidido por el responsable el
 * 2026-11-11). La línea es la que ya había en esa pantalla: la IDENTIDAD básica la ve cualquier
 * vínculo (nombre, apellidos, fecha, idioma, nacionalidad) y lo de gestión, solo el tutor legal.
 *
 * - El lugar de nacimiento es identidad, como la nacionalidad y la fecha: lo ven todos.
 * - El DNI, los hermanos, la provincia, las observaciones y «cómo nos has conocido», solo el tutor
 *   legal. El DNI no entra aunque identifique: quien recoge a un niño no necesita su número de
 *   documento, y es el dato que más daño hace suelto.
 *
 * Lo que no se enseña tampoco se LEE: al autorizado solo se le pide el lugar. Y desde
 * `20270115130000` la base tampoco se lo daría: los cinco de gestión salen por `ficha_gestion_ninos`
 * (Dirección y tutor legal), no de la tabla.
 */
export interface CamposAltaFicha {
  lugar_nacimiento: string | null
  dni?: string | null
  hermanos_total?: number | null
  hermanos_lugar?: number | null
  direccion_provincia?: string | null
  observaciones_familia?: string | null
  como_nos_conocio?: string | null
  como_nos_conocio_otro?: string | null
}

/** `null` = no se ha podido leer (la página lo dice; nunca rayas como si no hubiera nada). */
export async function leerCamposAltaFicha(
  supabase: SupabaseClient<Database>,
  ninoId: string,
  esTutorLegal: boolean
): Promise<CamposAltaFicha | null> {
  const { data, error } = await supabase
    .from('ninos')
    .select('lugar_nacimiento')
    .eq('id', ninoId)
    .maybeSingle()
  if (error || !data) return null
  if (!esTutorLegal) return data
  // Al tutor legal la función siempre le contesta su fila: si no viene, no se ha podido leer.
  const g = await leerFichaGestionDe(supabase, ninoId)
  if (!g) return null
  return {
    lugar_nacimiento: data.lugar_nacimiento,
    dni: g.dni,
    hermanos_total: g.hermanos_total,
    hermanos_lugar: g.hermanos_lugar,
    direccion_provincia: g.direccion_provincia,
    observaciones_familia: g.observaciones_familia,
    como_nos_conocio: g.como_nos_conocio,
    como_nos_conocio_otro: g.como_nos_conocio_otro,
  }
}
