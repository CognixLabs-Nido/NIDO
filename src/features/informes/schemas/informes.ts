import { z } from 'zod'

// Espejo de los ENUMs/CHECK de BD (F9-0) y de la spec (docs/specs/informes-evolucion.md).

export const periodoInformeEnum = z.enum(['trimestre_1', 'trimestre_2', 'trimestre_3', 'fin_curso'])

export const valoracionItemEnum = z.enum(['conseguido', 'en_proceso', 'no_iniciado'])

// Respuestas: mapa item_id → { valoracion, comentario? }. El comentario es opcional.
export const respuestaItemSchema = z.object({
  valoracion: valoracionItemEnum,
  comentario: z.string().trim().max(1000, 'informes.validation.comentario_largo').optional(),
})

export const respuestasSchema = z.record(z.string(), respuestaItemSchema)

const observacionesSchema = z
  .string()
  .trim()
  .max(4000, 'informes.validation.observaciones_largas')
  .nullable()
  .optional()

// --- Crear (elige niño + período + plantilla; el server congela el snapshot) ---
export const crearInformeSchema = z.object({
  nino_id: z.string().uuid('informes.validation.nino_requerido'),
  periodo: periodoInformeEnum,
  plantilla_id: z.string().uuid('informes.validation.plantilla_requerida'),
})
export type CrearInformeInput = z.input<typeof crearInformeSchema>

// --- Guardar borrador (puede estar incompleto) -------------------------------
export const guardarBorradorSchema = z.object({
  informe_id: z.string().uuid(),
  respuestas: respuestasSchema,
  observaciones_generales: observacionesSchema,
})
export type GuardarBorradorInput = z.input<typeof guardarBorradorSchema>

// --- Publicar (la regla "todos los ítems valorados" se valida contra el
//     snapshot en el server action, no en el esquema) --------------------------
export const publicarInformeSchema = z.object({
  informe_id: z.string().uuid(),
  respuestas: respuestasSchema,
  observaciones_generales: observacionesSchema,
})
export type PublicarInformeInput = z.input<typeof publicarInformeSchema>

// --- Despublicar (volver a borrador para corregir) ---------------------------
export const despublicarInformeSchema = z.object({
  informe_id: z.string().uuid(),
})
export type DespublicarInformeInput = z.input<typeof despublicarInformeSchema>

// --- Publicar en lote (F9-5-3) -----------------------------------------------
// `aula_id` opcional: presente = una aula (profe o dirección); ausente = todas las
// aulas del curso de la campaña (dirección "por centro"). La RLS acota qué informes
// puede publicar realmente cada rol.
export const publicarLoteSchema = z.object({
  campana_id: z.string().uuid(),
  aula_id: z.string().uuid().optional(),
})
export type PublicarLoteInput = z.input<typeof publicarLoteSchema>
