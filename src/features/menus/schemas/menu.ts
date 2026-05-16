import { z } from 'zod'

import {
  cantidadComidaEnum,
  momentoComidaEnum,
} from '@/features/agenda-diaria/schemas/agenda-diaria'

const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'menus.validation.fecha_invalida')
const nombrePlantillaSchema = z
  .string()
  .min(2, 'menus.validation.nombre_corto')
  .max(120, 'menus.validation.nombre_largo')
const descripcionMomentoSchema = z.string().max(500, 'menus.validation.descripcion_larga')

export const estadoPlantillaMenuEnum = z.enum(['borrador', 'publicada', 'archivada'])
export type EstadoPlantillaMenu = z.infer<typeof estadoPlantillaMenuEnum>

export const diaSemanaEnum = z.enum(['lunes', 'martes', 'miercoles', 'jueves', 'viernes'])
export type DiaSemana = z.infer<typeof diaSemanaEnum>

/**
 * Form de cabecera para crear/actualizar una plantilla. La transición
 * de estado se hace con acciones dedicadas (publicar/archivar).
 */
export const plantillaMenuCrearSchema = z
  .object({
    nombre: nombrePlantillaSchema,
    vigente_desde: fechaSchema.nullable(),
    vigente_hasta: fechaSchema.nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.vigente_desde && v.vigente_hasta && v.vigente_hasta < v.vigente_desde) {
      ctx.addIssue({
        code: 'custom',
        path: ['vigente_hasta'],
        message: 'menus.validation.rango_invalido',
      })
    }
  })
export type PlantillaMenuCrearInput = z.infer<typeof plantillaMenuCrearSchema>

export const plantillaMenuActualizarSchema = plantillaMenuCrearSchema.and(
  z.object({ id: z.string().uuid() })
)
export type PlantillaMenuActualizarInput = z.infer<typeof plantillaMenuActualizarSchema>

/**
 * Una fila de menú para un día de la semana. Cada momento es opcional —
 * la plantilla puede no tener desayuno pero sí comida, por ejemplo.
 */
export const plantillaMenuDiaSchema = z.object({
  plantilla_id: z.string().uuid(),
  dia_semana: diaSemanaEnum,
  desayuno: descripcionMomentoSchema.nullable(),
  media_manana: descripcionMomentoSchema.nullable(),
  comida: descripcionMomentoSchema.nullable(),
  merienda: descripcionMomentoSchema.nullable(),
})
export type PlantillaMenuDiaInput = z.infer<typeof plantillaMenuDiaSchema>

/**
 * Pase de lista batch de comida. Una fila por niño. El servidor convierte
 * cada item en un UPSERT sobre `comidas` por (agenda_id, momento), creando
 * la `agendas_diarias` cabecera si no existe (ADR-0012 lazy).
 */
export const comidaBatchItemSchema = z.object({
  nino_id: z.string().uuid(),
  descripcion: descripcionMomentoSchema.nullable(),
  cantidad: cantidadComidaEnum,
  observaciones: descripcionMomentoSchema.nullable(),
})
export type ComidaBatchItemInput = z.infer<typeof comidaBatchItemSchema>

export const comidaBatchInputSchema = z.object({
  fecha: fechaSchema,
  momento: momentoComidaEnum,
  items: z.array(comidaBatchItemSchema).min(1),
})
export type ComidaBatchInput = z.infer<typeof comidaBatchInputSchema>
