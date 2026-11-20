import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/db'

export interface FichaSinValidez {
  ninoId: string
  nombre: string
  apellidos: string | null
  /** De un JOIN LATERAL que la base no declara no nulo: `null` no se enseña como fecha. */
  firmadoAt: string | null
  refirmaPedida: boolean
}

/**
 * 2026-11-20 (el 14 de la medición): «cuando un cambio libre haga que la firma de la ficha deje de
 * valer, DIRECCIÓN TIENE QUE ENTERARSE. Hoy se invalida en silencio, y una ficha que ya no vale y nadie
 * sabe es peor que una sin firmar.» Las altas validadas cuya última firma ya no coincide con la ficha
 * (un cambio de la información médica o de los datos pedagógicos, que son libres), por
 * `fichas_firmadas_sin_validez`, que vuelve a calcular la ficha en la base. Con la refirma ya pedida
 * también salen, marcadas: la ficha sigue sin valer hasta que la familia vuelva a firmar.
 *
 * `null` si no se lee: una lista vacía diría «todas valen».
 */
export async function getFichasSinValidez(
  supabase: SupabaseClient<Database>,
  centroId: string
): Promise<FichaSinValidez[] | null> {
  const { data, error } = await supabase.rpc('fichas_firmadas_sin_validez', {
    p_centro_id: centroId,
  })
  if (error || !data) {
    logger.warn('getFichasSinValidez', error?.code ?? 'sin_respuesta')
    return null
  }
  return data.map((f) => ({
    ninoId: f.nino_id,
    nombre: f.nombre,
    apellidos: f.apellidos,
    firmadoAt: f.firmado_at,
    refirmaPedida: f.refirma_pedida,
  }))
}
