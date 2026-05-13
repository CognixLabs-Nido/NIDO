import { z } from 'zod'

const fechaRegex = /^\d{4}-\d{2}-\d{2}$/

export const asignarProfeAulaSchema = z.object({
  profe_id: z.string().uuid('profeAula.validation.profe_invalido'),
  fecha_inicio: z.string().regex(fechaRegex, 'profeAula.validation.fecha_formato'),
  es_profe_principal: z.boolean().default(false),
})

export type AsignarProfeAulaInput = z.infer<typeof asignarProfeAulaSchema>
