import { z } from 'zod'

// Requisitos definidos en docs/specs/auth.md (Fase 1).
export const passwordSchema = z
  .string()
  .min(12, { message: 'auth.validation.password.too_short' })
  .regex(/[A-Z]/, { message: 'auth.validation.password.uppercase_required' })
  .regex(/[0-9]/, { message: 'auth.validation.password.digit_required' })
  .regex(/[^A-Za-z0-9]/, { message: 'auth.validation.password.symbol_required' })

export type Password = z.infer<typeof passwordSchema>
