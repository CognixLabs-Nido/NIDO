import { z } from 'zod'

export const lactanciaEstadoEnum = z.enum([
  'materna',
  'biberon',
  'mixta',
  'finalizada',
  'no_aplica',
])

export const controlEsfinteresEnum = z.enum([
  'panal_completo',
  'transicion',
  'sin_panal_diurno',
  'sin_panal_total',
])

export const tipoAlimentacionEnum = z.enum([
  'omnivora',
  'vegetariana',
  'vegana',
  'sin_lactosa',
  'sin_gluten',
  'religiosa_halal',
  'religiosa_kosher',
  'otra',
])

export type LactanciaEstado = z.infer<typeof lactanciaEstadoEnum>
export type ControlEsfinteres = z.infer<typeof controlEsfinteresEnum>
export type TipoAlimentacion = z.infer<typeof tipoAlimentacionEnum>

// Acepta texto libre separado por comas en el form; se transforma a array
// de códigos ISO 639-1 (length 2, lowercase). Vacíos descartados.
const idiomasArraySchema = z
  .array(z.string().trim().toLowerCase().length(2, 'pedagogico.validation.idioma_iso_invalido'))
  .min(1, 'pedagogico.validation.idioma_min_uno')
  .max(8, 'pedagogico.validation.idioma_max_ocho')

export const datosPedagogicosInputSchema = z
  .object({
    nino_id: z.string().uuid(),
    lactancia_estado: lactanciaEstadoEnum,
    lactancia_observaciones: z.string().max(500).nullable().optional(),
    control_esfinteres: controlEsfinteresEnum,
    control_esfinteres_observaciones: z.string().max(500).nullable().optional(),
    siesta_horario_habitual: z.string().max(40).nullable().optional(),
    siesta_numero_diario: z.number().int().min(0).max(5).nullable().optional(),
    siesta_observaciones: z.string().max(500).nullable().optional(),
    tipo_alimentacion: tipoAlimentacionEnum,
    alimentacion_observaciones: z.string().max(500).nullable().optional(),
    idiomas_casa: idiomasArraySchema,
    tiene_hermanos_en_centro: z.boolean(),
  })
  .superRefine((val, ctx) => {
    if (val.tipo_alimentacion === 'otra' && !val.alimentacion_observaciones?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['alimentacion_observaciones'],
        message: 'pedagogico.validation.alimentacion_observaciones_requeridas',
      })
    }
  })

export type DatosPedagogicosInput = z.infer<typeof datosPedagogicosInputSchema>

// Parser tolerante para el input del form. Convierte un string "es, va, en"
// (con o sin espacios) en array antes de validar idiomas_casa.
export function parseIdiomasCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}
