'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { COOKIE_CENTRO_ACTIVO } from '../contexto/cookie'

const LocaleSchema = z.enum(['es', 'en', 'va'])

/**
 * «Salir del centro» del aviso de superusuario (Fase 3, ADR-0061): borra la cookie del centro
 * activo y vuelve al panel de plataforma (Fase 5). Desde el panel, entrar en otro centro es una
 * entrada nueva que `elegirCentro` registra en `audit_log`. La salida no se registra: no da
 * acceso a nada.
 */
export async function salirDelCentro(locale: string): Promise<never> {
  const destino = LocaleSchema.safeParse(locale).data ?? 'es'
  ;(await cookies()).delete(COOKIE_CENTRO_ACTIVO)
  redirect(`/${destino}/plataforma`)
}
