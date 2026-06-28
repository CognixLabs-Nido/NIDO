import { z } from 'zod'

// F12-B-2: beca concreta de un niño. importe en EUROS en la UI (la acción lo pasa a
// céntimos, positivo: el motor de cierre de B-4 creará la línea negativa). Periodo
// desde/hasta (fechas ISO YYYY-MM-DD del input date; comparación lexicográfica válida).
export const becaSchema = z
  .object({
    nino_id: z.string().uuid('becas.validation.nino_requerido'),
    tipo_beca_id: z.string().uuid('becas.validation.tipo_requerido'),
    importe_euros: z
      .number({ message: 'becas.validation.importe_invalido' })
      .gt(0, 'becas.validation.importe_positivo')
      .max(100000, 'becas.validation.importe_largo'),
    fecha_desde: z.string().min(1, 'becas.validation.desde_requerido'),
    fecha_hasta: z.string().nullable().optional(),
  })
  .refine((d) => !d.fecha_hasta || d.fecha_hasta >= d.fecha_desde, {
    message: 'becas.validation.periodo',
    path: ['fecha_hasta'],
  })

export type BecaInput = z.infer<typeof becaSchema>
