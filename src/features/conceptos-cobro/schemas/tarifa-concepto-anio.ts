import { z } from 'zod'

// B1-2: una tarifa de un concepto para un año de nacimiento concreto. La UI trabaja en
// EUROS; la action convierte a céntimos (columna `importe_centimos`, igual que el resto de
// importes de `conceptos_cobro` y que consume el motor de recibos). El año coincide con el
// CHECK de BD (2000–2100) y con EXTRACT(YEAR FROM ninos.fecha_nacimiento).
export const tarifaConceptoAnioSchema = z.object({
  concepto_id: z.string().uuid('conceptos_cobro.tarifa_anio.validation.concepto_requerido'),
  anio_nacimiento: z
    .number({ message: 'conceptos_cobro.tarifa_anio.validation.anio_invalido' })
    .int('conceptos_cobro.tarifa_anio.validation.anio_invalido')
    .min(2000, 'conceptos_cobro.tarifa_anio.validation.anio_invalido')
    .max(2100, 'conceptos_cobro.tarifa_anio.validation.anio_invalido'),
  importe_euros: z
    .number({ message: 'conceptos_cobro.tarifa_anio.validation.importe_invalido' })
    .min(0, 'conceptos_cobro.tarifa_anio.validation.importe_negativo')
    .max(100000, 'conceptos_cobro.tarifa_anio.validation.importe_largo'),
})

export type TarifaConceptoAnioInput = z.infer<typeof tarifaConceptoAnioSchema>
