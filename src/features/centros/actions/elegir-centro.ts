'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'

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
  ;(await cookies()).set(COOKIE_CENTRO_ACTIVO, contexto.centroId, OPCIONES_COOKIE_CENTRO_ACTIVO)
  redirect(rutaDeVuelta(parsed.data.locale, parsed.data.returnTo))
}
