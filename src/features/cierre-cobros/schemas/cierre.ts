import { z } from 'zod'

// F12-B-4: cierre de mes y recibo esporádico. Importes en EUROS en la UI; las actions
// los pasan a céntimos antes de llamar a las RPC.

export const cerrarMesSchema = z.object({
  anio: z.number().int().min(2024).max(2100),
  mes: z.number().int().min(1).max(12),
})
export type CerrarMesInput = z.infer<typeof cerrarMesSchema>

export const lineaEsporadicaSchema = z.object({
  descripcion: z
    .string()
    .trim()
    .min(1, 'cierre_cobros.validation.descripcion_requerida')
    .max(200, 'cierre_cobros.validation.descripcion_larga'),
  cantidad: z
    .number({ message: 'cierre_cobros.validation.cantidad_invalida' })
    .int('cierre_cobros.validation.cantidad_invalida')
    .min(1, 'cierre_cobros.validation.cantidad_invalida')
    .max(9999, 'cierre_cobros.validation.cantidad_invalida'),
  importe_euros: z
    .number({ message: 'cierre_cobros.validation.importe_invalido' })
    .min(0, 'cierre_cobros.validation.importe_negativo')
    .max(100000, 'cierre_cobros.validation.importe_largo'),
})

export const reciboEsporadicoSchema = z.object({
  ninoId: z.string().uuid(),
  anio: z.number().int().min(2024).max(2100),
  mes: z.number().int().min(1).max(12),
  concepto: z
    .string()
    .trim()
    .min(1, 'cierre_cobros.validation.concepto_requerido')
    .max(200, 'cierre_cobros.validation.concepto_largo'),
  metodo: z.enum(['sepa', 'efectivo', 'transferencia']).nullable(),
  lineas: z.array(lineaEsporadicaSchema).min(1, 'cierre_cobros.validation.sin_lineas'),
})
export type ReciboEsporadicoInput = z.infer<typeof reciboEsporadicoSchema>
