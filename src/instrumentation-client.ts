import * as Sentry from '@sentry/nextjs'

import { opcionesSentry } from '@/shared/lib/sentry/opciones'

// Sentry en el navegador (ADR-0056): solo errores, sin grabación de sesiones ni trazas.
Sentry.init(opcionesSentry('cliente'))
