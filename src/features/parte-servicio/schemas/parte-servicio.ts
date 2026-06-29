import { z } from 'zod'

const fechaSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'parte_servicio.validation.fecha_invalida')

/** Servicios diarios que apunta la profe (espejo del enum `servicio_diario` de BD). */
export const servicioDiarioEnum = z.enum(['comedor', 'matinera', 'vespertina'])
export type ServicioDiario = z.infer<typeof servicioDiarioEnum>

/** Una fila del pase de lista de servicio: el niño y si se queda o no. */
export const parteServicioItemSchema = z.object({
  nino_id: z.string().uuid(),
  presente: z.boolean(),
})

/**
 * Input del guardado batch del parte de servicio. El pase de lista envía
 * solo las filas dirty para un (fecha, servicio) concreto.
 */
export const parteServicioBatchInputSchema = z.object({
  centro_id: z.string().uuid(),
  fecha: fechaSchema,
  servicio: servicioDiarioEnum,
  items: z.array(parteServicioItemSchema).min(1).max(100),
})

export type ParteServicioItem = z.infer<typeof parteServicioItemSchema>
export type ParteServicioBatchInput = z.infer<typeof parteServicioBatchInputSchema>
