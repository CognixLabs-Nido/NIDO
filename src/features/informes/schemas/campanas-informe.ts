import { z } from 'zod'

// Validación de campañas de informe (F9-5). Límites espejo de la BD
// (20260610140000_phase9_5_0_campanas_informe.sql) y de la spec
// (docs/specs/campana-informes.md). Los mensajes son claves i18n.

const periodoSchema = z.enum(['trimestre_1', 'trimestre_2', 'trimestre_3', 'fin_curso'], {
  message: 'informes.campana.validation.periodo_invalido',
})

/**
 * Fecha límite: cadena `AAAA-MM-DD` que además debe ser una fecha de calendario
 * real (rechaza `2026-02-31`). El curso lo resuelve el server (curso activo, Q7);
 * la fecha es informativa (no bloquea el flujo individual de F9).
 */
const fechaLimiteSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'informes.campana.validation.fecha_invalida')
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d))
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  }, 'informes.campana.validation.fecha_invalida')

export const abrirCampanaSchema = z.object({
  periodo: periodoSchema,
  fecha_limite: fechaLimiteSchema,
})
export type AbrirCampanaInput = z.input<typeof abrirCampanaSchema>

export const editarFechaCampanaSchema = z.object({
  campana_id: z.string().uuid(),
  fecha_limite: fechaLimiteSchema,
})
export type EditarFechaCampanaInput = z.input<typeof editarFechaCampanaSchema>

export const cambiarEstadoCampanaSchema = z.object({
  campana_id: z.string().uuid(),
  estado: z.enum(['abierta', 'cerrada'], {
    message: 'informes.campana.validation.estado_invalido',
  }),
})
export type CambiarEstadoCampanaInput = z.input<typeof cambiarEstadoCampanaSchema>
