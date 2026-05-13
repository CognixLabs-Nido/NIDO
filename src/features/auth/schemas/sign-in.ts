import { z } from 'zod'

export const signInSchema = z.object({
  email: z.string().email({ message: 'auth.validation.email_invalid' }),
  password: z.string().min(1, { message: 'auth.validation.password_required' }),
})

export type SignInInput = z.infer<typeof signInSchema>
