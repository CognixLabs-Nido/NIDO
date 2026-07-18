import { z } from 'zod'

// D-6-3: beca comedor variable de un niño para un mes concreto. `importe` se guarda en
// EUROS directos (columna numeric en BD, positivo); el motor de recibos (D-6-2) lo aplica
// como línea NEGATIVA al (re)generar los recibos del mes. NO se pasa a céntimos aquí.
export const becaComedorMesSchema = z.object({
  nino_id: z.string().uuid('admin.cuotas.beca_comedor.validation.nino_requerido'),
  anio: z.number().int().min(2024).max(2100),
  mes: z.number().int().min(1).max(12),
  importe_euros: z
    .number({ message: 'admin.cuotas.beca_comedor.validation.importe_invalido' })
    .gt(0, 'admin.cuotas.beca_comedor.validation.importe_positivo')
    .max(100000, 'admin.cuotas.beca_comedor.validation.importe_largo'),
})

export type BecaComedorMesInput = z.infer<typeof becaComedorMesSchema>
