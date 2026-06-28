import { z } from 'zod'

// F12-B-2: lista estándar de tipos/orígenes de beca por centro (Conselleria, beca comedor…).
export const tipoBecaSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, 'becas.validation.tipo_nombre_requerido')
    .max(120, 'becas.validation.tipo_nombre_largo'),
  activo: z.boolean(),
})

export type TipoBecaInput = z.infer<typeof tipoBecaSchema>
