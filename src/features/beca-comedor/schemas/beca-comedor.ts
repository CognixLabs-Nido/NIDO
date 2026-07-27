import { z } from 'zod'

// Carga masiva de beca comedor v2 (V2-3): un importe único para un mes correspondiente,
// aplicado en un mes de aplicación. Se materializa como un tramo `origen='normal'` por cada
// alumno con elegibilidad activa. Importe en EUROS en el formulario; la action lo pasa a
// céntimos (el modelo usa `importe_centimos > 0`).
export const cargaBecaSchema = z.object({
  anio_correspondiente: z.number().int().min(2024).max(2100),
  mes_correspondiente: z.number().int().min(1).max(12),
  anio_aplicacion: z.number().int().min(2024).max(2100),
  mes_aplicacion: z.number().int().min(1).max(12),
  importe_euros: z.number().positive('admin.cuotas.beca_comedor.validation.importe_invalido'),
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
export const resolverDesbordeSchema = z.object({
  recibo_id: z.string().uuid(),
  via: z.enum(['diferir', 'transferencia']),
})

export type ResolverDesbordeInput = z.infer<typeof resolverDesbordeSchema>

// Marcar una transferencia como REALIZADA (V2-5, pestaña Remesas).
export const marcarTransferenciaSchema = z.object({
  id: z.string().uuid(),
})

export type MarcarTransferenciaInput = z.infer<typeof marcarTransferenciaSchema>
