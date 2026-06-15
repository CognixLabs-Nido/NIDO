import { z } from 'zod'

import { parentescoEnum } from '@/features/vinculos/schemas/vinculo'

import { passwordSchema } from './password'

export const userRoleSchema = z.enum(['admin', 'profe', 'tutor_legal', 'autorizado'])

// El admin solo elige principal/secundario para tutor_legal; autorizado → 'autorizado'
// y admin/profe → NULL los fija la acción (no se piden en el input).
export const tutorTipoVinculoEnum = z.enum(['tutor_legal_principal', 'tutor_legal_secundario'])

export const sendInvitationSchema = z
  .object({
    email: z.string().email({ message: 'auth.validation.email_invalid' }),
    rolObjetivo: userRoleSchema,
    centroId: z.string().uuid(),
    ninoId: z.string().uuid().optional(),
    aulaId: z.string().uuid().optional(),
    tipoVinculo: tutorTipoVinculoEnum.optional(),
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
  .refine((data) => (data.tipoVinculo ? data.rolObjetivo === 'tutor_legal' : true), {
    // tipoVinculo solo aplica a tutor_legal (principal/secundario).
    message: 'auth.validation.tipo_vinculo_invalido',
    path: ['tipoVinculo'],
  })

export const acceptInvitationSchema = z
  .object({
    token: z.string().uuid(),
    nombreCompleto: z.string().min(2).max(120),
    password: passwordSchema,
    idiomaPreferido: z.enum(['es', 'en', 'va']),
    aceptaTerminos: z.literal(true, { message: 'auth.validation.terms_required' }),
    aceptaPrivacidad: z.literal(true, { message: 'auth.validation.privacy_required' }),
    // Parentesco del vínculo familiar (el tutor lo declara). Opcional en el schema:
    // la acción lo EXIGE cuando la invitación es de rol familiar (tutor_legal/autorizado).
    parentesco: parentescoEnum.optional(),
    descripcionParentesco: z.string().max(120).optional().nullable(),
  })
  .refine((d) => (d.parentesco === 'otro' ? !!d.descripcionParentesco : true), {
    message: 'vinculo.validation.descripcion_requerida',
    path: ['descripcionParentesco'],
  })

export type UserRole = z.infer<typeof userRoleSchema>
export type SendInvitationInput = z.infer<typeof sendInvitationSchema>
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>
