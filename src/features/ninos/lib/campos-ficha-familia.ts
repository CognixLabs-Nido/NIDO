import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

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
 * Lo que no se enseña tampoco se LEE: al autorizado solo se le pide el lugar. Esto es la pantalla;
 * que la base no le dé la fila entera va en su propia pieza.
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
  if (esTutorLegal) {
    const { data, error } = await supabase
      .from('ninos')
      .select(
        'lugar_nacimiento, dni, hermanos_total, hermanos_lugar, direccion_provincia, observaciones_familia, como_nos_conocio, como_nos_conocio_otro'
      )
      .eq('id', ninoId)
      .maybeSingle()
    return error || !data ? null : data
  }
  const { data, error } = await supabase
    .from('ninos')
    .select('lugar_nacimiento')
    .eq('id', ninoId)
    .maybeSingle()
  return error || !data ? null : data
}
