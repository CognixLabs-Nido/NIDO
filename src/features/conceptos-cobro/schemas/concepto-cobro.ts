import { z } from 'zod'

// F12-B-1: catálogo de conceptos de cobro. El precio se introduce en EUROS en la UI
// (mensajes de error = claves i18n) y la server action lo convierte a céntimos para BD.
export const TIPOS_CONCEPTO = ['mensual', 'diario', 'esporadico'] as const

export const conceptoCobroSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, 'conceptos_cobro.validation.nombre_requerido')
    .max(120, 'conceptos_cobro.validation.nombre_largo'),
  tipo_concepto: z.enum(TIPOS_CONCEPTO, {
    message: 'conceptos_cobro.validation.tipo_invalido',
  }),
  precio_euros: z
    .number({ message: 'conceptos_cobro.validation.precio_invalido' })
    .min(0, 'conceptos_cobro.validation.precio_negativo')
    .max(100000, 'conceptos_cobro.validation.precio_largo'),
  activo: z.boolean(),
})

export type ConceptoCobroInput = z.infer<typeof conceptoCobroSchema>
