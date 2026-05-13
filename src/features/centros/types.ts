// Patrón Result compartido por las server actions de Fase 2.
// Idéntico al de Fase 1 (src/features/auth/actions/types.ts) — duplicado a
// propósito para mantener cada feature independiente.
export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

export function fail(error: string): ActionResult<never> {
  return { success: false, error }
}
