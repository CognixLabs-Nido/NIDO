'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { COOKIE_CENTRO_ACTIVO, OPCIONES_COOKIE_CENTRO_ACTIVO } from '../contexto/cookie'
import { contextoEnCentro } from '../contexto/get-contexto-centro'
import { rutaDeVuelta } from '../contexto/ruta-de-vuelta'

const EntradaSchema = z.object({
  centroId: z.string().uuid(),
  locale: z.enum(['es', 'en', 'va']),
  returnTo: z.string().max(2000).nullish(),
})

export type ResultadoElegirCentro = { success: false; error: string }

/**
 * Fija el centro activo (multicentro · Fase 1). Es lo ÚNICO que escribe la cookie: el render
 * de una página nunca la toca (MisterFC #756). Solo acepta un centro donde el usuario tiene un
 * rol activo; si no, no escribe nada.
 *
 * El superusuario (Fase 3, ADR-0061) entra en cualquier centro, y cada entrada queda en
 * `audit_log` (`registrar_entrada_superusuario`) ANTES de escribir la cookie: si no se puede
 * registrar, no entra. Su cookie es de sesión: al cerrar el navegador vuelve a elegir, y esa
 * entrada también queda registrada.
 */
export async function elegirCentro(entrada: {
  centroId: string
  locale: string
  returnTo?: string | null
}): Promise<ResultadoElegirCentro> {
  const parsed = EntradaSchema.safeParse(entrada)
  if (!parsed.success) return { success: false, error: 'centros.elegir.errors.invalido' }

  const contexto = await contextoEnCentro(parsed.data.centroId)
  if (!contexto) return { success: false, error: 'centros.elegir.errors.no_es_tuyo' }

  if (contexto.esSuperusuario) {
    const supabase = await createClient()
    const { error } = await supabase.rpc('registrar_entrada_superusuario', {
      p_centro_id: contexto.centroId,
    })
    if (error) {
      logger.warn('elegirCentro: no se pudo registrar la entrada del superusuario', {
        code: error.code,
      })
      return { success: false, error: 'centros.elegir.errors.entrada_no_registrada' }
    }
  }
  // La del superusuario, de sesión (sin maxAge).
  const { maxAge, ...deSesion } = OPCIONES_COOKIE_CENTRO_ACTIVO
  const opciones = contexto.esSuperusuario ? deSesion : { ...deSesion, maxAge }
  ;(await cookies()).set(COOKIE_CENTRO_ACTIVO, contexto.centroId, opciones)
  redirect(rutaDeVuelta(parsed.data.locale, parsed.data.returnTo))
}
