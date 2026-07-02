import { z } from 'zod'

export const aulaSchema = z.object({
  nombre: z.string().min(2, 'aula.validation.nombre_corto').max(80),
  cohorte_anos_nacimiento: z
    .array(z.number().int().min(2020).max(2030))
    .min(1, 'aula.validation.cohorte_vacia')
    .max(5, 'aula.validation.cohorte_demasiados'),
  descripcion: z.string().max(500).optional().nullable(),
  capacidad_maxima: z
    .number()
    .int()
    .min(1, 'aula.validation.capacidad_min')
    .max(40, 'aula.validation.capacidad_max'),
})

export type AulaInput = z.infer<typeof aulaSchema>
