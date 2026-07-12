import { z } from 'zod'

/**
 * F-3-F — reincorporar (desarchivar) a un niño dado de baja. Niño-scoped: revive el
 * registro del niño (mismo id) y abre una matrícula NUEVA en el curso activo, por lo
 * que exige elegir el `aula_id` del curso activo en el mismo acto (no hay niños
 * activos sin matrícula). Toda la lógica vive en la RPC `desarchivar_nino`.
 */
export const desarchivarNinoSchema = z.object({
  nino_id: z.string().uuid(),
  aula_id: z.string().uuid('nino.desarchivar.validation.aula_requerida'),
})

export type DesarchivarNinoInput = z.infer<typeof desarchivarNinoSchema>
