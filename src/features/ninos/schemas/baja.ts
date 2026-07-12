import { z } from 'zod'

/**
 * F-3-D — baja intra-curso (niño-scoped). La baja archiva al NIÑO (cierra todas
 * sus matrículas + vínculos), no una matrícula concreta → la clave es `nino_id`,
 * no `matricula_id`. El `motivo` es obligatorio: toda baja debe dejar constancia.
 */
export const bajaNinoSchema = z.object({
  nino_id: z.string().uuid(),
  motivo: z
    .string()
    .trim()
    .min(1, 'nino.baja.validation.motivo_requerido')
    .max(500, 'nino.baja.validation.motivo_largo'),
})

export type BajaNinoInput = z.infer<typeof bajaNinoSchema>
