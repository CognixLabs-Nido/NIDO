import { z } from 'zod'

// Límites espejo de los CHECK / convenciones de BD (F9-0,
// 20260609130000_phase9_0_informes_evolucion.sql) y de la spec
// (docs/specs/informes-evolucion.md). El contenido va en castellano (Q10).

const itemSchema = z.object({
  // `id` estable del ítem. Opcional en la entrada: el server lo rellena con un
  // uuid si falta (ítems nuevos). Se preserva al editar.
  id: z.string().uuid().optional(),
  texto: z
    .string()
    .trim()
    .min(1, 'informes.validation.item_vacio')
    .max(500, 'informes.validation.item_largo'),
})

const areaSchema = z.object({
  titulo: z
    .string()
    .trim()
    .min(1, 'informes.validation.area_titulo_vacio')
    .max(200, 'informes.validation.area_titulo_largo'),
  items: z.array(itemSchema).min(1, 'informes.validation.area_sin_items'),
})

// Para guardar: al menos un área, y cada área con al menos un ítem.
export const estructuraSchema = z.array(areaSchema).min(1, 'informes.validation.sin_areas')

const tituloSchema = z
  .string()
  .trim()
  .min(1, 'informes.validation.nombre_vacio')
  .max(200, 'informes.validation.nombre_largo')

export const crearPlantillaInformeSchema = z.object({
  titulo: tituloSchema,
  estructura: estructuraSchema,
})
export type CrearPlantillaInformeInput = z.input<typeof crearPlantillaInformeSchema>

export const editarPlantillaInformeSchema = z.object({
  plantilla_id: z.string().uuid(),
  titulo: tituloSchema,
  estructura: estructuraSchema,
})
export type EditarPlantillaInformeInput = z.input<typeof editarPlantillaInformeSchema>

export const archivarPlantillaInformeSchema = z.object({
  plantilla_id: z.string().uuid(),
})
export type ArchivarPlantillaInformeInput = z.input<typeof archivarPlantillaInformeSchema>
