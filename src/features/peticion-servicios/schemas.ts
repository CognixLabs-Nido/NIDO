import { z } from 'zod'

import { SERVICIOS, type Servicio } from './lib/peticion'

/**
 * Fase 8b — una respuesta de la petición de servicios: `{servicio, respuesta, concepto_id}`, con el
 * concepto si y solo si no es «no». La forma la vuelve a mirar la base (`privado.respuestas_servicio`),
 * y que el concepto sea una opción ofrecida, solo la base.
 */
export const respuestaServicioSchema = z
  .object({
    servicio: z.enum(SERVICIOS as [Servicio, ...Servicio[]]),
    respuesta: z.enum(['no', 'mensual', 'dias_sueltos']),
    concepto_id: z.string().uuid().nullable(),
  })
  .strict()
  .refine((r) => (r.respuesta === 'no') === (r.concepto_id === null), {
    message: 'concepto_si_pide',
  })

/** Las respuestas de una vez: de 1 a 10, una por servicio. */
export const respuestasServicioSchema = z
  .array(respuestaServicioSchema)
  .min(1)
  .max(10)
  .refine((rs) => new Set(rs.map((r) => r.servicio)).size === rs.length, {
    message: 'servicio_repetido',
  })

export const guardarPeticionServiciosSchema = z.object({
  nino_id: z.string().uuid(),
  respuestas: respuestasServicioSchema,
})

export type GuardarPeticionServiciosInput = z.infer<typeof guardarPeticionServiciosSchema>
