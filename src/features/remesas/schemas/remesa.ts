import { z } from 'zod'

import { eurosACentimos } from '@/shared/lib/format-money'

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

/** Formas de un cobro manual que no piden importe: se cobra el recibo entero (PR-1a). */
export const FORMAS_COBRO_DIRECTO = ['efectivo', 'transferencia'] as const

/** Formas que ofrece «Marcar cobrado». El cheque pide su importe y va por su propia action (PR-1b). */
export const FORMAS_COBRO_MANUAL = [...FORMAS_COBRO_DIRECTO, 'cheque_guarderia'] as const

/** Cómo se cobra la diferencia de un cheque menor que el recibo: pasar recibo, efectivo o transferencia. */
export const METODOS_DIFERENCIA = ['sepa', 'efectivo', 'transferencia'] as const

const fechaCobro = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'remesas.validation.fecha_cobro_invalida')
/** Vacía = sin nota (la action la guarda como NULL). */
const notaCobro = z.string().trim().max(500, 'remesas.validation.nota_cobro_larga').optional()

/**
 * Marca un recibo como cobrado manualmente (efectivo/transferencia fuera de SEPA): la forma, la
 * fecha (por defecto hoy, nunca futura; lo comprueba la action) y una nota opcional.
 */
export const marcarCobradoManualSchema = z.object({
  reciboId: z.string().uuid(),
  forma: z.enum(FORMAS_COBRO_DIRECTO),
  fecha: fechaCobro,
  nota: notaCobro,
})
export type MarcarCobradoManualInput = z.infer<typeof marcarCobradoManualSchema>

/**
 * Cobra un recibo con cheque guardería / ticket restaurant (PR-1b): el importe del cheque, la
 * fecha, la nota y, si el cheque es menor que el recibo, cómo se cobra la diferencia. Que el
 * cheque no supere el recibo y que la diferencia lleve método lo comprueba la BD
 * (`cobrar_recibo_con_cheque`), que es la que conoce el total.
 */
export const cobrarConChequeSchema = z.object({
  reciboId: z.string().uuid(),
  importe_euros: z
    .number({ message: 'remesas.validation.importe_cheque_invalido' })
    .positive('remesas.validation.importe_cheque_invalido'),
  fecha: fechaCobro,
  nota: notaCobro,
  metodoDiferencia: z.enum(METODOS_DIFERENCIA).optional(),
})
export type CobrarConChequeInput = z.infer<typeof cobrarConChequeSchema>

/**
 * El formulario de «Marcar cobrado», que conoce el total del recibo: con cheque, el importe es
 * obligatorio, no supera el recibo y, si es menor, hay que elegir cómo se cobra la diferencia.
 */
export function crearCobroDialogSchema(totalCentimos: number) {
  return z
    .object({
      reciboId: z.string().uuid(),
      forma: z.enum(FORMAS_COBRO_MANUAL),
      fecha: fechaCobro,
      nota: notaCobro,
      importe_euros: z.number({ message: 'remesas.validation.importe_cheque_invalido' }).optional(),
      metodoDiferencia: z.enum(METODOS_DIFERENCIA).optional(),
    })
    .superRefine((v, ctx) => {
      if (v.forma !== 'cheque_guarderia') return
      const importe = v.importe_euros
      if (importe === undefined || !Number.isFinite(importe) || importe <= 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['importe_euros'],
          message: 'remesas.validation.importe_cheque_invalido',
        })
        return
      }
      const centimos = eurosACentimos(importe)
      if (centimos > totalCentimos) {
        ctx.addIssue({
          code: 'custom',
          path: ['importe_euros'],
          message: 'remesas.errors.cheque_supera_recibo',
        })
      } else if (centimos < totalCentimos && !v.metodoDiferencia) {
        ctx.addIssue({
          code: 'custom',
          path: ['metodoDiferencia'],
          message: 'remesas.validation.falta_metodo_diferencia',
        })
      }
    })
}
export type CobroDialogInput = z.infer<ReturnType<typeof crearCobroDialogSchema>>

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
