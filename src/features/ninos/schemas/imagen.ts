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

/**
 * Re-autorización del consentimiento de imagen de UN niño por su tutor legal (portal de
 * familia). El consentimiento se otorga a nombre de quien llama (la RPC lo fuerza).
 */
export const otorgarImagenNinoSchema = z.object({
  nino_id: z.string().uuid(),
})

export type OtorgarImagenNinoInput = z.infer<typeof otorgarImagenNinoSchema>

/**
 * El «no» de la imagen de UN niño, y retirarlo, por su tutor legal desde el portal de familia (fase
 * 10, 10a-2). Cada tutor responde por sí: el «no» y su retirada son a nombre de quien llama.
 */
export const respuestaImagenNinoSchema = z.object({
  nino_id: z.string().uuid(),
})

export type RespuestaImagenNinoInput = z.infer<typeof respuestaImagenNinoSchema>
