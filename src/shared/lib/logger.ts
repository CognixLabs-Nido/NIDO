// Logger mínimo compartido. No incluir PII (emails, nombres, datos médicos).
// En Fase 11 se sustituye por un servicio externo (highlight.io / GlitchTip).

type LogLevel = 'info' | 'warn' | 'error'

function log(level: LogLevel, ...args: unknown[]): void {
  if (process.env.NODE_ENV === 'production' && level === 'info') {
    return
  }
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.warn
  fn(`[${level}]`, ...args)
}

export const logger = {
  info: (...args: unknown[]) => log('info', ...args),
  warn: (...args: unknown[]) => log('warn', ...args),
  error: (...args: unknown[]) => log('error', ...args),
}
