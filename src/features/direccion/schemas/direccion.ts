import { z } from 'zod'

import { idiomaCorreoEnum } from '@/features/auth/schemas/invitation'

/** Invitar a una directora: su correo y el idioma del correo de invitación. */
export const invitarDirectoraSchema = z.object({
  email: z.string().trim().email({ message: 'auth.validation.email_invalid' }),
  idioma: idiomaCorreoEnum,
})

export type InvitarDirectoraInput = z.infer<typeof invitarDirectoraSchema>
