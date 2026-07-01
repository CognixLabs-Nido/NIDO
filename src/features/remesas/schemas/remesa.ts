import { z } from 'zod'

// Esquemas de la remesa SEPA (B-5). Fuente de verdad de tipos vía z.infer.

export const crearRemesaSchema = z.object({
  anio: z.number().int().min(2024).max(2100),
  mes: z.number().int().min(1).max(12),
  reciboIds: z.array(z.string().uuid()).min(1, 'remesas.validation.sin_recibos'),
})
export type CrearRemesaInput = z.infer<typeof crearRemesaSchema>

export const marcarRemesaEnviadaSchema = z.object({
  remesaId: z.string().uuid(),
})
export type MarcarRemesaEnviadaInput = z.infer<typeof marcarRemesaEnviadaSchema>

// Config del acreedor. CID obligatorio; BIC opcional (8 u 11); IBAN opcional al
// editar (vacío = preservar el cifrado existente), con longitud SEPA si se aporta.
export const datosAcreedorSchema = z.object({
  identificador_acreedor: z
    .string()
    .trim()
    .min(8, 'remesas.validation.cid_invalido')
    .max(35, 'remesas.validation.cid_invalido'),
  bic_acreedor: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || v.length === 8 || v.length === 11,
      'remesas.validation.bic_invalido'
    ),
  iban: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || (v.length >= 15 && v.length <= 34),
      'remesas.validation.iban_invalido'
    ),
})
export type DatosAcreedorInput = z.infer<typeof datosAcreedorSchema>
