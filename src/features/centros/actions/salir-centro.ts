'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { COOKIE_CENTRO_ACTIVO } from '../contexto/cookie'

const LocaleSchema = z.enum(['es', 'en', 'va'])

/**
 * «Salir del centro» del aviso de superusuario (Fase 3, ADR-0061): borra la cookie del centro
 * activo y vuelve al selector. El superusuario elige siempre (`exigirEleccion`), así que sin
 * cookie el selector le lista todos los centros, y entrar en otro es una entrada nueva que
 * `elegirCentro` registra en `audit_log`. La salida no se registra: no da acceso a nada.
 *
 * Cuando exista el panel de plataforma (Fase 5) el destino será el panel.
 */
export async function salirDelCentro(locale: string): Promise<never> {
  const destino = LocaleSchema.safeParse(locale).data ?? 'es'
  ;(await cookies()).delete(COOKIE_CENTRO_ACTIVO)
  redirect(`/${destino}/elegir-centro`)
}
