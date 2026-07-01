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

// ─── B-6 devoluciones ────────────────────────────────────────────────────────

/** Marca un recibo (enviado_banco) como devuelto. */
export const marcarReciboDevueltoSchema = z.object({
  reciboId: z.string().uuid(),
})
export type MarcarReciboDevueltoInput = z.infer<typeof marcarReciboDevueltoSchema>

/** Marca un recibo como cobrado manualmente (efectivo/transferencia fuera de SEPA). */
export const marcarCobradoManualSchema = z.object({
  reciboId: z.string().uuid(),
})
export type MarcarCobradoManualInput = z.infer<typeof marcarCobradoManualSchema>

/** Re-gira el importe de un recibo devuelto: crea un recibo nuevo ligado al original. */
export const crearRegiroSchema = z.object({
  reciboId: z.string().uuid(),
})
export type CrearRegiroInput = z.infer<typeof crearRegiroSchema>

/** Gastos de devolución que cobra el banco → recibo esporádico ligado al niño. */
export const gastosDevolucionSchema = z.object({
  reciboId: z.string().uuid(),
  importe_euros: z
    .number({ message: 'remesas.validation.importe_invalido' })
    .positive('remesas.validation.importe_positivo'),
  metodo: z.enum(['sepa', 'efectivo', 'transferencia']),
})
export type GastosDevolucionInput = z.infer<typeof gastosDevolucionSchema>

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
