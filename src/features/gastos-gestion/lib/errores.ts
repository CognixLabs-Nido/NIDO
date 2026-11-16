import { logger } from '@/shared/lib/logger'

/**
 * Fase 9 — el error de `declarar_gastos_gestion`, dicho por su HINT; lo demás, «no se pudo
 * guardar». `alta_validada` no llega aquí: quien llama lo convierte en la cola.
 */
export function errorDeclararGastos(error: {
  code?: string
  hint?: string | null
  message: string
}): string {
  if (error.code === '42501') return 'alta.errors.no_autorizado'
  if (error.hint === 'curso_sin_gastos') return 'gastos_gestion.errors.curso_sin_gastos'
  if (error.hint === 'forma') return 'gastos_gestion.errors.invalido'
  logger.warn('declarar_gastos_gestion', error.code ?? 'sin_codigo')
  return 'gastos_gestion.errors.guardar'
}
