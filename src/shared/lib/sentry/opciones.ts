import type * as SentryTipos from '@sentry/nextjs'

import { limpiarEvento, limpiarMiga } from './limpiar-evento'

/**
 * Opciones de `Sentry.init` para los tres runtimes de Next (ADR-0056). Todo lo que
 * decide QUÉ sale de nuestra infraestructura está aquí, en un solo sitio y con test.
 */

type OpcionesInit = NonNullable<Parameters<typeof SentryTipos.init>[0]>
type Integracion = { name: string }
export type Runtime = 'cliente' | 'servidor' | 'edge'

/**
 * Solo la región de la UE (Frankfurt). Un DSN de otra región deja Sentry APAGADO en vez
 * de mandar datos fuera: la región la fija el DSN, no una casilla que se pueda olvidar.
 */
export function dsnDeLaUE(dsn: string | undefined): string | undefined {
  if (!dsn) return undefined
  try {
    return new URL(dsn).hostname.endsWith('.ingest.de.sentry.io') ? dsn : undefined
  } catch {
    return undefined
  }
}

/**
 * Integraciones del navegador que se conservan: las que capturan el error y su contexto
 * técnico. Es una lista de PERMITIDAS a propósito: lo que no esté aquí no se carga, así
 * que la grabación de sesiones (Replay), el formulario de feedback, las trazas de
 * rendimiento (BrowserTracing), las sesiones (BrowserSession) o la consola quedan fuera
 * aunque una versión futura del SDK las active por defecto.
 */
export const INTEGRACIONES_CLIENTE_PERMITIDAS: ReadonlySet<string> = new Set([
  'EventFilters',
  'FunctionToString',
  'BrowserApiErrors',
  'Breadcrumbs',
  'GlobalHandlers',
  'LinkedErrors',
  'Dedupe',
  'HttpContext',
  'CultureContext',
  'NextjsClientStackFrameNormalization',
])

/**
 * En el servidor se quitan las que recogen datos (variables locales, consola). El resto
 * se queda: sostienen el aislamiento por petición y los manejadores de errores no
 * capturados, y lo único que envían son eventos, que pasan todos por `beforeSend`.
 */
export const INTEGRACIONES_SERVIDOR_QUITADAS: ReadonlySet<string> = new Set([
  'LocalVariables',
  'LocalVariablesAsync',
  'Console',
  'ConversationId',
])

export function filtrarIntegraciones<T extends Integracion>(runtime: Runtime, integraciones: T[]) {
  return runtime === 'cliente'
    ? integraciones.filter((i) => INTEGRACIONES_CLIENTE_PERMITIDAS.has(i.name))
    : integraciones.filter((i) => !INTEGRACIONES_SERVIDOR_QUITADAS.has(i.name))
}

type RecogidaDeDatos = NonNullable<OpcionesInit['dataCollection']>

/**
 * Nada de datos del usuario ni de la petición. En la v11 del SDK `sendDefaultPii` ya no
 * existe: lo sustituye `dataCollection`, y sus valores por defecto lo recogen TODO (IP,
 * cookies, cabeceras, cuerpos, query, consultas a la BD, variables locales…).
 */
export const RECOGIDA_DE_DATOS_APAGADA: RecogidaDeDatos = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  frameContextLines: 0,
}

export function opcionesSentry(
  runtime: Runtime,
  env: { dsn?: string; entorno?: string } = {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    entorno: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV,
  }
): OpcionesInit {
  const dsn = dsnDeLaUE(env.dsn)
  return {
    dsn,
    enabled: dsn !== undefined,
    environment: env.entorno ?? 'development',
    dataCollection: RECOGIDA_DE_DATOS_APAGADA,
    // Solo errores. Sin `tracesSampleRate` ni `tracesSampler` no hay trazas de rendimiento
    // (OJO: `tracesSampleRate: 0` las ENCIENDE, con muestreo 0). Logs y métricas, fuera.
    beforeSendLog: () => null,
    beforeSendMetric: () => null,
    beforeSend: (evento) => limpiarEvento(evento),
    beforeBreadcrumb: (miga) => limpiarMiga(miga),
    integrations: (porDefecto) => filtrarIntegraciones(runtime, porDefecto),
    // El túnel (`/monitoring`, los eventos del navegador salen por nuestro dominio) lo
    // configura `tunnelRoute` en next.config.ts: genera la ruta y la reescritura a la UE.
    ...(runtime === 'cliente' ? { replaysSessionSampleRate: 0, replaysOnErrorSampleRate: 0 } : {}),
  }
}
