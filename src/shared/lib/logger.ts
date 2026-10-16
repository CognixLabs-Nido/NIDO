import * as Sentry from '@sentry/nextjs'

// Logger mínimo compartido. No incluir PII (emails, nombres, datos médicos).
// `error` además manda el fallo a Sentry (ADR-0056). Antes de salir pasa por
// `limpiarEvento` (src/shared/lib/sentry), que quita los datos personales que reconoce;
// el detalle completo se queda en la consola, es decir, en los logs de Vercel.

type LogLevel = 'info' | 'warn' | 'error'

function log(level: LogLevel, ...args: unknown[]): void {
  if (process.env.NODE_ENV === 'production' && level === 'info') {
    return
  }
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.warn
  fn(`[${level}]`, ...args)
}

/**
 * Un `logger.error(...)` como evento de Sentry: el primer `Error` de los argumentos (o uno
 * nuevo con el primer texto, para tener mensaje y traza) y el resto como contexto. Sin
 * Sentry inicializado (tests, local, sin DSN de la UE) no hace nada.
 */
function reportarError(args: unknown[]): void {
  const error = args.find((a): a is Error => a instanceof Error)
  const contexto = args.filter((a) => !(a instanceof Error))
  const mensaje = contexto.find((a): a is string => typeof a === 'string') ?? 'logger.error'
  Sentry.captureException(error ?? new Error(mensaje), { extra: { contexto } })
}

export const logger = {
  info: (...args: unknown[]) => log('info', ...args),
  warn: (...args: unknown[]) => log('warn', ...args),
  error: (...args: unknown[]) => {
    log('error', ...args)
    reportarError(args)
  },
}
