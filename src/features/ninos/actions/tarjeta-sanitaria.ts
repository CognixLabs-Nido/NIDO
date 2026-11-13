'use server'

import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { leerTarjetaSanitariaDe } from '../lib/tarjeta-sanitaria'
import { fail, ok, type ActionResult } from '../../centros/types'

/**
 * Fase 7 (decidido el 2026-11-13): el número de la tarjeta sanitaria para la profe del aula, que
 * puede ser quien lleve al niño al centro de salud. La imagen no: con el número le basta. Se lee AL
 * PULSAR, por `sip_de_ninos` (la Dirección, el tutor legal y la profe del niño; el autorizado,
 * nada). Un fallo de lectura no es «sin tarjeta»: vuelve como error.
 */
export async function numeroTarjetaSanitaria(
  ninoId: string
): Promise<ActionResult<{ sip: string | null }>> {
  const parsed = z.string().uuid().safeParse(ninoId)
  if (!parsed.success) return fail('nino.tarjeta_sanitaria.errors.no_leido')
  const supabase = await createClient()
  const t = await leerTarjetaSanitariaDe(supabase, parsed.data)
  if (!t) {
    logger.warn('numeroTarjetaSanitaria', t === null ? 'error' : 'sin_fila')
    return fail('nino.tarjeta_sanitaria.errors.no_leido')
  }
  return ok({ sip: t.sip })
}
