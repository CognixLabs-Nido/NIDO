import { z } from 'zod'

const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ausencia.validation.fecha_invalida')
const descripcionSchema = z.string().max(500, 'ausencia.validation.descripcion_larga')

export const motivoAusenciaEnum = z.enum([
  'enfermedad',
  'cita_medica',
  'vacaciones',
  'familiar',
  'otro',
])
export type MotivoAusencia = z.infer<typeof motivoAusenciaEnum>

export const ausenciaInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    nino_id: z.string().uuid(),
    fecha_inicio: fechaSchema,
    fecha_fin: fechaSchema,
    motivo: motivoAusenciaEnum,
    descripcion: descripcionSchema.nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.fecha_fin < v.fecha_inicio) {
      ctx.addIssue({
        code: 'custom',
        path: ['fecha_fin'],
        message: 'ausencia.validation.fecha_fin_anterior',
      })
    }
  })

export type AusenciaInput = z.infer<typeof ausenciaInputSchema>

export const PREFIX_CANCELADA = '[cancelada] '

/** Detecta si una descripción ya está marcada como cancelada. */
export function esCancelada(descripcion: string | null | undefined): boolean {
  return Boolean(descripcion && descripcion.startsWith(PREFIX_CANCELADA))
}
