import { z } from 'zod'

import { updateCentroSchema } from '@/features/centros/schemas/centro'
import { createCursoSchema } from '@/features/cursos/schemas/curso'

/**
 * Crear un centro desde la plataforma (Fase 5, PR 2): los datos del centro sin SEPA, logo ni web
 * (decisión del responsable), el curso con el que nace y el email de su admin, obligatorio. Las
 * reglas de cada campo son las de editar el centro y crear un curso.
 */
export const crearCentroSchema = updateCentroSchema
  .omit({ web: true })
  .extend({
    curso_nombre: createCursoSchema.shape.nombre,
    curso_inicio: createCursoSchema.shape.fecha_inicio,
    curso_fin: createCursoSchema.shape.fecha_fin,
    email_admin: z.string().trim().email('plataforma.errores.email_admin').max(254),
  })
  .refine((d) => d.curso_inicio < d.curso_fin, {
    message: 'curso.validation.fechas_invertidas',
    path: ['curso_fin'],
  })

export type CrearCentroInput = z.infer<typeof crearCentroSchema>

export const invitarAdminSchema = z.object({
  centroId: z.string().uuid(),
  /** Sin email: reenviar la última invitación de admin del centro. */
  email: z.string().trim().email('plataforma.errores.email_admin').max(254).optional(),
})

export type InvitarAdminInput = z.infer<typeof invitarAdminSchema>
