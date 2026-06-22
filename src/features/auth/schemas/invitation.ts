import { z } from 'zod'

import { TIPO_PERSONAL_AULA } from '@/features/profes-aulas/types'
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

// Alta tutor-driven (Pieza 2b): la dirección invita a la familia creando un
// ESQUELETO de niño (solo nombre + aula); apellidos/fecha/identidad las completa
// el tutor en el wizard. El centro se deriva server-side (no se pide en el input).
export const invitarFamiliaConEsqueletoSchema = z.object({
  nombreNino: z.string().min(1, 'nino.validation.nombre_requerido').max(80),
  aulaId: z.string().uuid('nino.validation.aula_invalida'),
  email: z.string().email({ message: 'auth.validation.email_invalid' }),
  // Requerido (sin .default() para no romper el tipo input/output del zodResolver);
  // el formulario lo provee vía defaultValues = 'tutor_legal_principal'.
  tipoVinculo: tutorTipoVinculoEnum,
})

// Onboarding de profesor (F11-C-1): la dirección invita a un profe fijando su
// nombre, email, un aula y su "rol" en el aula (tipo_personal_aula). El centro se
// deriva server-side del aula (no se pide). El user_role siempre es 'profe'.
export const invitarProfeSchema = z.object({
  nombreCompleto: z.string().min(2, 'auth.validation.nombre_invalido').max(120),
  email: z.string().email({ message: 'auth.validation.email_invalid' }),
  aulaId: z.string().uuid('auth.validation.aula_id_required'),
  tipoPersonalAula: z.enum(TIPO_PERSONAL_AULA),
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
export type InvitarFamiliaConEsqueletoInput = z.infer<typeof invitarFamiliaConEsqueletoSchema>
export type InvitarProfeInput = z.infer<typeof invitarProfeSchema>
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>
