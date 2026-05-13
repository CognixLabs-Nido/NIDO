import { z } from 'zod'

import { passwordSchema } from './password'

export const requestPasswordResetSchema = z.object({
  email: z.string().email({ message: 'auth.validation.email_invalid' }),
})

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'auth.validation.passwords_do_not_match',
    path: ['confirmPassword'],
  })

export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
