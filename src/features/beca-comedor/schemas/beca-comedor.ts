import { z } from 'zod'

// Carga de beca comedor v2 (V2-3; por alumno desde el PR-10): el importe de CADA becado para
// un mes correspondiente, aplicado en un mes de aplicación (el de toda la carga). Cada fila con
// importe es un tramo `origen='normal'`; sin importe, ese alumno no tiene beca ese mes. Importe
// en EUROS en el formulario; la action lo pasa a céntimos (el modelo usa `importe_centimos > 0`).
export const importeAlumnoSchema = z.object({
  nino_id: z.string().uuid(),
  importe_euros: z
    .number()
    .positive('admin.cuotas.beca_comedor.validation.importe_invalido')
    .nullable(),
})

export const cargaBecaSchema = z.object({
  anio_correspondiente: z.number().int().min(2024).max(2100),
  mes_correspondiente: z.number().int().min(1).max(12),
  anio_aplicacion: z.number().int().min(2024).max(2100),
  mes_aplicacion: z.number().int().min(1).max(12),
  importes: z
    .array(importeAlumnoSchema)
    .max(1000)
    .refine((fs) => new Set(fs.map((f) => f.nino_id)).size === fs.length, {
      message: 'admin.cuotas.beca_comedor.errors.invalid',
    }),
})

export type CargaBecaInput = z.infer<typeof cargaBecaSchema>

// Toggle de elegibilidad (V2-2): marca/desmarca la beca de un alumno en el curso activo.
export const toggleElegibilidadSchema = z.object({
  nino_id: z.string().uuid(),
  activa: z.boolean(),
})

export type ToggleElegibilidadInput = z.infer<typeof toggleElegibilidadSchema>

// Resolución de un desborde (V2-4). DOS vías (Jose colapsó reducir+resto en "diferir"):
//   · 'diferir'       → el exceso se descuenta en el recibo del MES SIGUIENTE (tramos
//                        origen='resto' repartidos por niño). Se guarda como via='reducir'
//                        en el modelo (el ENUM del modelo no tiene 'diferir'; 'reducir' es
//                        la semántica D-P9 "difiere al mes siguiente").
//   · 'transferencia' → el exceso se devuelve por banco (fila beca_comedor_transferencia).
// PR-1c: el sobrante de un cheque guardería / ticket restaurant se resuelve igual, por las dos
// vías, pero lo escribe la BD (`resolver_sobrante_cheque`): diferirlo es una línea de saldo a favor
// en el recibo del mes siguiente, sin reparto (no hay beca que repartir).
export const resolverDesbordeSchema = z.object({
  recibo_id: z.string().uuid(),
  via: z.enum(['diferir', 'transferencia']),
  origen: z.enum(['beca', 'cheque']),
})

export type ResolverDesbordeInput = z.infer<typeof resolverDesbordeSchema>

// Marcar una transferencia como REALIZADA (V2-5, pestaña Remesas).
export const marcarTransferenciaSchema = z.object({
  id: z.string().uuid(),
})

export type MarcarTransferenciaInput = z.infer<typeof marcarTransferenciaSchema>
