import { z } from 'zod'

export const idiomaCentroEnum = z.enum(['es', 'en', 'va'])

export const updateCentroSchema = z.object({
  nombre: z.string().min(2, 'centro.validation.nombre_corto').max(120),
  direccion: z.string().min(2, 'centro.validation.direccion_corta').max(240),
  telefono: z.string().min(5, 'centro.validation.telefono_corto').max(30),
  email_contacto: z.string().email('centro.validation.email_invalido').max(120),
  web: z.string().url('centro.validation.web_invalida').max(240).optional().nullable(),
  idioma_default: idiomaCentroEnum,
})

export type UpdateCentroInput = z.infer<typeof updateCentroSchema>
