import { z } from 'zod'

const fechaSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'parte_servicio.validation.fecha_invalida')

/** Servicios diarios que se apuntan (espejo del enum `servicio_diario` de BD). */
export const servicioDiarioEnum = z.enum(['comedor', 'matinera', 'vespertina'])
export type ServicioDiario = z.infer<typeof servicioDiarioEnum>

/** Una casilla del listado único: un niño, un servicio, si se queda o no. */
export const paseServiciosItemSchema = z.object({
  nino_id: z.string().uuid(),
  servicio: servicioDiarioEnum,
  presente: z.boolean(),
})

/**
 * PR-12 — guardado del listado único: solo las casillas que han cambiado, de los tres servicios
 * a la vez, para un día. Sin repetir (niño, servicio): el upsert no admite dos veces la misma fila.
 */
export const paseServiciosInputSchema = z.object({
  centro_id: z.string().uuid(),
  fecha: fechaSchema,
  items: z
    .array(paseServiciosItemSchema)
    .min(1)
    .max(1500)
    .refine(
      (items) => new Set(items.map((i) => `${i.nino_id}:${i.servicio}`)).size === items.length,
      'parte_servicio.errors.guardar_fallo'
    ),
})

export type PaseServiciosItem = z.infer<typeof paseServiciosItemSchema>
export type PaseServiciosInput = z.infer<typeof paseServiciosInputSchema>
