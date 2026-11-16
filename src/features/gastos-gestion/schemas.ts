import { z } from 'zod'

import { FORMAS_GASTOS } from './lib/gastos'

/** Fase 9 — cómo paga la familia los gastos de gestión de un curso (sin justificante). */
export const declararGastosSchema = z.object({
  nino_id: z.string().uuid(),
  curso_academico_id: z.string().uuid(),
  forma: z.enum(FORMAS_GASTOS),
})
export type DeclararGastosInput = z.infer<typeof declararGastosSchema>

/** Céntimos enteros, como el CHECK de la tabla (0 a 10 000 000). */
const centimos = z.number().int().min(0).max(10_000_000)

export const fijarImporteCursoSchema = z.object({
  curso_academico_id: z.string().uuid(),
  /** NULL quita el importe: el centro deja de cobrarlos ese curso. Si viene, mayor que 0. */
  importe_centimos: centimos.min(1).nullable(),
})
export type FijarImporteCursoInput = z.infer<typeof fijarImporteCursoSchema>

export const fijarImporteNinoSchema = z.object({
  nino_id: z.string().uuid(),
  curso_academico_id: z.string().uuid(),
  /** NULL vuelve al importe del curso; 0, nada que pagar. */
  importe_centimos: centimos.nullable(),
})
export type FijarImporteNinoInput = z.infer<typeof fijarImporteNinoSchema>

export const marcarCobroSchema = z.object({
  nino_id: z.string().uuid(),
  curso_academico_id: z.string().uuid(),
  cobrado: z.boolean(),
})
export type MarcarCobroInput = z.infer<typeof marcarCobroSchema>
