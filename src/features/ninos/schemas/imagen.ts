import { z } from 'zod'

/**
 * IU-4 — revocación del consentimiento de imagen de UN niño (niño-scoped). Solo
 * necesita el `nino_id`: la acción de Dirección revoca el consent y elimina la foto
 * de perfil. Por-niño estricto (no toca hermanos).
 */
export const revocarImagenNinoSchema = z.object({
  nino_id: z.string().uuid(),
})

export type RevocarImagenNinoInput = z.infer<typeof revocarImagenNinoSchema>
