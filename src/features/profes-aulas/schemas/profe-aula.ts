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
