import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { logger } from '@/shared/lib/logger'

import type { Database } from '@/types/database'

import { DIAS_ALTA_SIN_TERMINAR } from '../lib/alta-sin-terminar'

export interface AltaSinTerminar {
  ninoId: string
  estado: 'invitacion_abierta' | 'sin_invitacion' | 'iniciada'
  desde: string | null
  propuesta: boolean
  email: string | null
  familiaNueva: boolean
}

/**
 * Las altas sin terminar del centro (matrícula pendiente), con su estado y si ya se le proponen a
 * Dirección para borrar (`altas_sin_terminar`, con la sesión: solo Dirección del centro). NULL si
 * no se pudo leer: quien la pinta no dice «no hay» cuando no lo sabe.
 */
export async function getAltasSinTerminar(
  supabase: SupabaseClient<Database>,
  centroId: string
): Promise<AltaSinTerminar[] | null> {
  const { data, error } = await supabase.rpc('altas_sin_terminar', {
    p_centro_id: centroId,
    p_dias: DIAS_ALTA_SIN_TERMINAR,
  })
  if (error || !Array.isArray(data)) {
    logger.warn('altas sin terminar', error?.message ?? 'sin respuesta')
    return null
  }
  return data.map((a) => ({
    ninoId: a.nino_id,
    estado: a.estado as AltaSinTerminar['estado'],
    desde: a.desde,
    propuesta: a.propuesta,
    email: a.email,
    familiaNueva: a.familia_nueva,
  }))
}
