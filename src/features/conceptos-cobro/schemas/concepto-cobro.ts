import { z } from 'zod'

// F-4-0: catálogo de conceptos con MODELO ÚNICO de valor. Un concepto es:
//  · signo   (+1 cobro / −1 descuento)
//  · tipo_valor ('fijo' → importe en euros ; 'porcentaje' → % con 2 decimales)
//  · tipo_concepto (mensual/diario/esporadico = periodicidad; el ENUM se mantiene)
//  · ambito  (nino/familia) ; servicio (comedor/matinera/vespertina, solo si diario)
//  · concepto_base_id: el concepto base de un descuento PORCENTUAL (1:1). Solo (y
//    siempre) cuando es descuento porcentual (signo=−1 ∧ tipo_valor='porcentaje').
// La UI trabaja en EUROS/% ; la action convierte a céntimos/basis points.
export const TIPOS_CONCEPTO = ['mensual', 'diario', 'esporadico'] as const
export const SERVICIOS_DIARIOS = ['comedor', 'matinera', 'vespertina'] as const
export const SIGNOS = [1, -1] as const
export const TIPOS_VALOR = ['fijo', 'porcentaje'] as const
export const AMBITOS = ['nino', 'familia'] as const

// Importe fijo en euros (nullable). El input vacío manda null; NaN no pasa .min(0).
const importeEurosField = z
  .number({ message: 'conceptos_cobro.validation.precio_invalido' })
  .min(0, 'conceptos_cobro.validation.precio_negativo')
  .max(100000, 'conceptos_cobro.validation.precio_largo')
  .nullable()

// Porcentaje en % (0–100, hasta 2 decimales). La action lo convierte a basis points.
const porcentajeField = z
  .number({ message: 'conceptos_cobro.validation.porcentaje_invalido' })
  .min(0, 'conceptos_cobro.validation.porcentaje_negativo')
  .max(100, 'conceptos_cobro.validation.porcentaje_largo')
  .nullable()

export const conceptoCobroSchema = z
  .object({
    nombre: z
      .string()
      .trim()
      .min(1, 'conceptos_cobro.validation.nombre_requerido')
      .max(120, 'conceptos_cobro.validation.nombre_largo'),
    signo: z.union([z.literal(1), z.literal(-1)], {
      message: 'conceptos_cobro.validation.signo_invalido',
    }),
    tipo_valor: z.enum(TIPOS_VALOR, { message: 'conceptos_cobro.validation.tipo_valor_invalido' }),
    tipo_concepto: z.enum(TIPOS_CONCEPTO, {
      message: 'conceptos_cobro.validation.tipo_invalido',
    }),
    ambito: z.enum(AMBITOS, { message: 'conceptos_cobro.validation.ambito_invalido' }),
    importe_euros: importeEurosField,
    porcentaje: porcentajeField,
    servicio: z.enum(SERVICIOS_DIARIOS).nullable(),
    // Concepto base del descuento porcentual (uuid del catálogo). Nullable.
    concepto_base_id: z.string().uuid().nullable(),
    activo: z.boolean(),
  })
  .superRefine((v, ctx) => {
    // (a) valor: fijo ⇒ importe ; porcentaje ⇒ porcentaje. Exclusivos.
    if (v.tipo_valor === 'fijo' && v.importe_euros == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['importe_euros'],
        message: 'conceptos_cobro.validation.importe_requerido',
      })
    }
    if (v.tipo_valor === 'porcentaje' && v.porcentaje == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['porcentaje'],
        message: 'conceptos_cobro.validation.porcentaje_requerido',
      })
    }
    // (b) periodicidad: diario ⇒ servicio (mensual/esporadico no llevan).
    if (v.tipo_concepto === 'diario' && v.servicio == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['servicio'],
        message: 'conceptos_cobro.validation.servicio_requerido',
      })
    }
    // (c) base: descuento porcentual ⇒ exige concepto base ; el resto NO lo lleva.
    const esDescuentoPorcentual = v.signo === -1 && v.tipo_valor === 'porcentaje'
    if (esDescuentoPorcentual && v.concepto_base_id == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['concepto_base_id'],
        message: 'conceptos_cobro.validation.concepto_base_requerido',
      })
    }
    if (!esDescuentoPorcentual && v.concepto_base_id != null) {
      ctx.addIssue({
        code: 'custom',
        path: ['concepto_base_id'],
        message: 'conceptos_cobro.validation.concepto_base_no_permitido',
      })
    }
  })

export type ConceptoCobroInput = z.infer<typeof conceptoCobroSchema>
