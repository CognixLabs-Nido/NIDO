import { z } from 'zod'

const fechaRegex = /^\d{4}-\d{2}-\d{2}$/

export const cambioAulaSchema = z.object({
  matricula_actual_id: z.string().uuid(),
  nueva_aula_id: z.string().uuid('matricula.validation.aula_invalida'),
  fecha_baja: z.string().regex(fechaRegex, 'matricula.validation.fecha_formato'),
  motivo_baja: z.string().max(500).optional().nullable(),
})

export type CambioAulaInput = z.infer<typeof cambioAulaSchema>

export const darDeBajaSchema = z.object({
  matricula_id: z.string().uuid(),
  fecha_baja: z.string().regex(fechaRegex),
  motivo_baja: z.string().max(500).optional().nullable(),
})

export type DarDeBajaInput = z.infer<typeof darDeBajaSchema>
