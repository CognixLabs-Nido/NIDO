import * as Sentry from '@sentry/nextjs'

import { opcionesSentry } from '@/shared/lib/sentry/opciones'

// Sentry en servidor y edge (ADR-0056). Las opciones —qué se envía y qué no— viven en
// `opcionesSentry`; sin DSN de la UE no se inicializa nada.
export function register(): void {
  if (process.env.NEXT_RUNTIME === 'nodejs') Sentry.init(opcionesSentry('servidor'))
  if (process.env.NEXT_RUNTIME === 'edge') Sentry.init(opcionesSentry('edge'))
}

// Errores de Server Components, route handlers y server actions. Pasan por `beforeSend`
// como cualquier otro evento: la petición llega sin cabeceras, cookies ni cuerpo.
export const onRequestError = Sentry.captureRequestError
