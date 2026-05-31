// Constantes del feature recordatorios (F6).
//
// IMPORTANTE: este archivo NO lleva la directiva 'use server'. Las constantes
// top-level rompen el bundler de Next.js 16 si conviven con server actions en
// un módulo 'use server' (lección PR #30). Mantenerlas aquí, aparte de las
// actions, es deliberado.

/** Prefijo de anulación. Mismo patrón que F3/F4/F5 ('[anulado] ' en mensajes
 *  y anuncios; '[cancelada] ' en ausencias). 10 caracteres. */
export const PREFIX_ANULADO = '[anulado] '

/** Ventana de anulación de un recordatorio por su emisor: 5 minutos desde
 *  `created_at`. Coherente con la ventana de mensajería (ADR-0031). Se enforza
 *  en el server action (no en RLS), ver ADR-0036. */
export const VENTANA_ANULACION_MS = 5 * 60 * 1000
