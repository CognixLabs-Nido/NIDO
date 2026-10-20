import 'server-only'

import { logger } from '@/shared/lib/logger'

/**
 * Correo transaccional propio de la app, por la API de Resend (PR 1 de la Fase 4).
 *
 * Supabase Auth manda sus correos (invitación a una cuenta nueva, recuperar contraseña) por el
 * SMTP de Resend que tiene configurado; la app no puede usar ese SMTP para nada más. Este es el
 * otro camino, para lo que Auth no cubre: el aviso de invitación a una cuenta que YA existe.
 *
 * Mismo proveedor y mismo dominio verificado (nido03.es, remitente no-reply@nido03.es), así que no
 * entra un encargado nuevo. La clave, `RESEND_API_KEY`, solo vive en el servidor (Vercel y
 * `.env.local`).
 *
 * Nunca lanza: devuelve si salió o por qué no. No registra la dirección ni el contenido, solo el
 * estado HTTP.
 */

const REMITENTE = 'NIDO <no-reply@nido03.es>'
const API = 'https://api.resend.com/emails'
const TIEMPO_MAXIMO_MS = 10_000

export interface Correo {
  para: string
  asunto: string
  texto: string
  html: string
}

export type ResultadoEnvio = { enviado: true } | { enviado: false; motivo: 'sin_clave' | 'fallo' }

export async function enviarCorreo(correo: Correo): Promise<ResultadoEnvio> {
  const clave = process.env.RESEND_API_KEY
  if (!clave) {
    logger.warn('enviarCorreo: falta RESEND_API_KEY')
    return { enviado: false, motivo: 'sin_clave' }
  }

  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: REMITENTE,
        to: [correo.para],
        subject: correo.asunto,
        text: correo.texto,
        html: correo.html,
      }),
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
    })
    if (!res.ok) {
      logger.warn('enviarCorreo: Resend rechazó el envío', res.status)
      return { enviado: false, motivo: 'fallo' }
    }
    return { enviado: true }
  } catch (err) {
    logger.warn('enviarCorreo: sin respuesta de Resend', err instanceof Error ? err.name : 'error')
    return { enviado: false, motivo: 'fallo' }
  }
}
