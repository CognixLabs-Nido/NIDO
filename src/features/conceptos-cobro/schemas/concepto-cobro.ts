import { z } from 'zod'

// F12-B-1/B-4: catálogo de conceptos de cobro. Precios en EUROS en la UI (la action
// los pasa a céntimos). Dos precios (mensual/diario) + servicio para conceptos diarios.
export const TIPOS_CONCEPTO = ['mensual', 'diario', 'esporadico'] as const
export const SERVICIOS_DIARIOS = ['comedor', 'matinera', 'vespertina'] as const

// Campo de precio en euros (nullable). El input numérico vacío manda null desde el form;
// un valor inválido (NaN) no pasa el .min(0) → error de validación, que es lo deseado.
const precioEurosField = z
  .number({ message: 'conceptos_cobro.validation.precio_invalido' })
  .min(0, 'conceptos_cobro.validation.precio_negativo')
  .max(100000, 'conceptos_cobro.validation.precio_largo')
  .nullable()

export const conceptoCobroSchema = z
  .object({
    nombre: z
      .string()
      .trim()
      .min(1, 'conceptos_cobro.validation.nombre_requerido')
      .max(120, 'conceptos_cobro.validation.nombre_largo'),
    tipo_concepto: z.enum(TIPOS_CONCEPTO, {
      message: 'conceptos_cobro.validation.tipo_invalido',
    }),
    precio_mensual_euros: precioEurosField,
    precio_diario_euros: precioEurosField,
    servicio: z.enum(SERVICIOS_DIARIOS).nullable(),
    activo: z.boolean(),
  })
  .superRefine((v, ctx) => {
    // mensual / esporádico: exige precio mensual (precio único).
    if (v.tipo_concepto === 'mensual' || v.tipo_concepto === 'esporadico') {
      if (v.precio_mensual_euros == null) {
        ctx.addIssue({
          code: 'custom',
          path: ['precio_mensual_euros'],
          message: 'conceptos_cobro.validation.precio_requerido',
        })
      }
    }
    // diario: exige precio diario + servicio (el mensual es opcional).
    if (v.tipo_concepto === 'diario') {
      if (v.precio_diario_euros == null) {
        ctx.addIssue({
          code: 'custom',
          path: ['precio_diario_euros'],
          message: 'conceptos_cobro.validation.precio_diario_requerido',
        })
      }
      if (v.servicio == null) {
        ctx.addIssue({
          code: 'custom',
          path: ['servicio'],
          message: 'conceptos_cobro.validation.servicio_requerido',
        })
      }
    }
  })

export type ConceptoCobroInput = z.infer<typeof conceptoCobroSchema>
