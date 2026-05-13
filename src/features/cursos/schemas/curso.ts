import { z } from 'zod'

export const cursoEstadoEnum = z.enum(['planificado', 'activo', 'cerrado'])

const fechaRegex = /^\d{4}-\d{2}-\d{2}$/

export const createCursoSchema = z
  .object({
    nombre: z.string().min(2, 'curso.validation.nombre_corto').max(40),
    fecha_inicio: z.string().regex(fechaRegex, 'curso.validation.fecha_formato'),
    fecha_fin: z.string().regex(fechaRegex, 'curso.validation.fecha_formato'),
  })
  .refine((d) => d.fecha_inicio < d.fecha_fin, {
    message: 'curso.validation.fechas_invertidas',
    path: ['fecha_fin'],
  })

export type CreateCursoInput = z.infer<typeof createCursoSchema>
