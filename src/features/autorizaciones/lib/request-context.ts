import 'server-only'

import { headers } from 'next/headers'

/** Contexto probatorio de la petición de firma (patrón de `consentimientos`). */
export interface RequestContext {
  /** IP del cliente en claro (`inet`), o null si no se puede derivar. A
   *  diferencia del rate-limit de auth (que la hashea), aquí se guarda en claro:
   *  es contexto probatorio de la firma, no un identificador a minimizar. */
  ip: string | null
  userAgent: string | null
}

/**
 * Extrae IP y user-agent de las cabeceras de la request para guardarlos junto a
 * la firma (`firmas_autorizacion.ip_address`/`user_agent`). En Vercel la IP real
 * llega en `x-forwarded-for` (primer salto) o `x-real-ip`.
 */
export async function getRequestContext(): Promise<RequestContext> {
  const h = await headers()
  const forwarded = h.get('x-forwarded-for') ?? ''
  const ip = forwarded.split(',')[0]?.trim() || h.get('x-real-ip') || null
  const userAgent = h.get('user-agent')
  return { ip: ip || null, userAgent: userAgent || null }
}
