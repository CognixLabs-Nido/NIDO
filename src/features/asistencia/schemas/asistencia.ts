import { z } from 'zod'

const horaSchema = z.string().regex(/^\d{2}:\d{2}$/, 'asistencia.validation.hora_invalida')
const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'asistencia.validation.fecha_invalida')
const observacionesSchema = z.string().max(500, 'asistencia.validation.observaciones_largas')

export const estadoAsistenciaEnum = z.enum([
  'presente',
  'ausente',
  'llegada_tarde',
  'salida_temprana',
])
export type EstadoAsistencia = z.infer<typeof estadoAsistenciaEnum>

/**
 * Input del formulario de asistencia (una fila del pase de lista).
 * `nino_id` y `fecha` los conoce el padre del form y se pasan a la
 * server action junto a este input.
 */
export const asistenciaInputSchema = z
  .object({
    estado: estadoAsistenciaEnum,
    hora_llegada: horaSchema.nullable(),
    hora_salida: horaSchema.nullable(),
    observaciones: observacionesSchema.nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.estado === 'presente' && !v.hora_llegada) {
      ctx.addIssue({
        code: 'custom',
        path: ['hora_llegada'],
        message: 'asistencia.validation.requiere_hora_llegada',
      })
    }
    if (v.estado === 'llegada_tarde' && !v.hora_llegada) {
      ctx.addIssue({
        code: 'custom',
        path: ['hora_llegada'],
        message: 'asistencia.validation.requiere_hora_llegada',
      })
    }
    if (v.estado === 'salida_temprana' && !v.hora_salida) {
      ctx.addIssue({
        code: 'custom',
        path: ['hora_salida'],
        message: 'asistencia.validation.requiere_hora_salida',
      })
    }
    if (v.hora_llegada && v.hora_salida && v.hora_salida <= v.hora_llegada) {
      ctx.addIssue({
        code: 'custom',
        path: ['hora_salida'],
        message: 'asistencia.validation.salida_anterior_llegada',
      })
    }
  })

export type AsistenciaInput = z.infer<typeof asistenciaInputSchema>

export const asistenciaBatchItemSchema = z.object({
  nino_id: z.string().uuid(),
  asistencia: asistenciaInputSchema,
})

export const asistenciaBatchInputSchema = z.object({
  fecha: fechaSchema,
  items: z.array(asistenciaBatchItemSchema).min(1),
})
export type AsistenciaBatchInput = z.infer<typeof asistenciaBatchInputSchema>
