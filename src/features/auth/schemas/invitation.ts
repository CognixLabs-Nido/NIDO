import { z } from 'zod'

import { passwordSchema } from './password'

export const userRoleSchema = z.enum(['admin', 'profe', 'tutor_legal', 'autorizado'])

export const sendInvitationSchema = z
  .object({
    email: z.string().email({ message: 'auth.validation.email_invalid' }),
    rolObjetivo: userRoleSchema,
    centroId: z.string().uuid(),
    ninoId: z.string().uuid().optional(),
    aulaId: z.string().uuid().optional(),
  })
  .refine(
    (data) => (['tutor_legal', 'autorizado'].includes(data.rolObjetivo) ? !!data.ninoId : true),
    {
      message: 'auth.validation.nino_id_required',
      path: ['ninoId'],
    }
  )
  .refine((data) => (data.rolObjetivo === 'profe' ? !!data.aulaId : true), {
    message: 'auth.validation.aula_id_required',
    path: ['aulaId'],
  })

export const acceptInvitationSchema = z.object({
  token: z.string().uuid(),
  nombreCompleto: z.string().min(2).max(120),
  password: passwordSchema,
  idiomaPreferido: z.enum(['es', 'en', 'va']),
  aceptaTerminos: z.literal(true, {
    errorMap: () => ({ message: 'auth.validation.terms_required' }),
  }),
  aceptaPrivacidad: z.literal(true, {
    errorMap: () => ({ message: 'auth.validation.privacy_required' }),
  }),
})

export type UserRole = z.infer<typeof userRoleSchema>
export type SendInvitationInput = z.infer<typeof sendInvitationSchema>
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>
