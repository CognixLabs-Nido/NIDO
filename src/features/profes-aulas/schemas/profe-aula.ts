import { z } from 'zod'

import { TIPO_PERSONAL_AULA } from '../types'

const fechaRegex = /^\d{4}-\d{2}-\d{2}$/

// F5B-#34: tipo_personal_aula reemplaza al booleano es_profe_principal.
// Default 'profesora' coherente con el default de la columna en BD: la
// action no decide coordinadora por su cuenta — esa decisión es explícita
// del admin desde la UI.
export const asignarProfeAulaSchema = z.object({
  profe_id: z.string().uuid('profeAula.validation.profe_invalido'),
  fecha_inicio: z.string().regex(fechaRegex, 'profeAula.validation.fecha_formato'),
  tipo_personal_aula: z.enum(TIPO_PERSONAL_AULA).default('profesora'),
})

export type AsignarProfeAulaInput = z.infer<typeof asignarProfeAulaSchema>

// --- Sprint pre-F6 item 4: mutaciones sobre asignaciones existentes ---
// Todas operan por `asignacion_id` (el `profes_aulas.id`), que la UI conoce
// desde `getPersonalAula`. La RLS `profes_aulas_admin_all` filtra que el
// admin solo toque filas de su centro.

export const terminarAsignacionSchema = z.object({
  asignacion_id: z.string().uuid('profeAula.validation.asignacion_invalida'),
})
export type TerminarAsignacionInput = z.infer<typeof terminarAsignacionSchema>

export const cambiarTipoPersonalSchema = z.object({
  asignacion_id: z.string().uuid('profeAula.validation.asignacion_invalida'),
  tipo_personal_aula: z.enum(TIPO_PERSONAL_AULA),
})
export type CambiarTipoPersonalInput = z.infer<typeof cambiarTipoPersonalSchema>

export const sustituirCoordinadoraSchema = z.object({
  aula_id: z.string().uuid('profeAula.validation.aula_invalida'),
  nueva_asignacion_id: z.string().uuid('profeAula.validation.asignacion_invalida'),
})
export type SustituirCoordinadoraInput = z.infer<typeof sustituirCoordinadoraSchema>

export const moverProfeAulaSchema = z.object({
  asignacion_id: z.string().uuid('profeAula.validation.asignacion_invalida'),
  aula_destino_id: z.string().uuid('profeAula.validation.aula_invalida'),
})
export type MoverProfeAulaInput = z.infer<typeof moverProfeAulaSchema>
