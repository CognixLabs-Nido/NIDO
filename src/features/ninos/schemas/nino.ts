import { z } from 'zod'

const fechaRegex = /^\d{4}-\d{2}-\d{2}$/

export const ninoSchema = z.object({
  nombre: z.string().min(1, 'nino.validation.nombre_requerido').max(80),
  apellidos: z.string().min(1, 'nino.validation.apellidos_requeridos').max(120),
  fecha_nacimiento: z
    .string()
    .regex(fechaRegex, 'nino.validation.fecha_formato')
    .refine((d) => new Date(d) <= new Date(), { message: 'nino.validation.fecha_futura' }),
  sexo: z.enum(['F', 'M', 'X']).optional().nullable(),
  nacionalidad: z.string().max(60).optional().nullable(),
  idioma_principal: z.enum(['es', 'en', 'va']).default('es'),
  notas_admin: z.string().max(1000).optional().nullable(),
})

export const infoMedicaSchema = z.object({
  alergias_graves: z.string().max(2000).optional().nullable(),
  notas_emergencia: z.string().max(2000).optional().nullable(),
  medicacion_habitual: z.string().max(2000).optional().nullable(),
  alergias_leves: z.string().max(2000).optional().nullable(),
  medico_familia: z.string().max(120).optional().nullable(),
  telefono_emergencia: z.string().max(30).optional().nullable(),
})

export const crearNinoCompletoSchema = z.object({
  datos: ninoSchema,
  medica: infoMedicaSchema.optional(),
  aula_id: z.string().uuid('nino.validation.aula_invalida'),
  confirmar_fuera_cohorte: z.boolean().optional(),
})

export type NinoInput = z.infer<typeof ninoSchema>
export type InfoMedicaInput = z.infer<typeof infoMedicaSchema>
export type CrearNinoCompletoInput = z.infer<typeof crearNinoCompletoSchema>
