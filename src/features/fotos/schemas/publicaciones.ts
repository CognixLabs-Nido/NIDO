import { z } from 'zod'

import { MIME_FOTO_ENTRADA, MAX_TEXTO_PUBLICACION } from '../types'

/**
 * Esquemas de validación de F10-1. Las claves de error son i18n (`fotos.validation.*`);
 * el binario real (tipo/tamaño) SIEMPRE se revalida server-side antes de `sharp`
 * (no nos fiamos del MIME declarado por el cliente).
 */

export const crearPublicacionSchema = z.object({
  aula_id: z.string().uuid('fotos.validation.aula_invalida'),
  texto: z.string().trim().max(MAX_TEXTO_PUBLICACION, 'fotos.validation.texto_largo').optional(),
})
export type CrearPublicacionInput = z.infer<typeof crearPublicacionSchema>

export const editarPublicacionSchema = z.object({
  publicacion_id: z.string().uuid(),
  texto: z
    .string()
    .trim()
    .max(MAX_TEXTO_PUBLICACION, 'fotos.validation.texto_largo')
    .optional()
    .nullable(),
})
export type EditarPublicacionInput = z.infer<typeof editarPublicacionSchema>

export const eliminarPublicacionSchema = z.object({
  publicacion_id: z.string().uuid(),
})
export type EliminarPublicacionInput = z.infer<typeof eliminarPublicacionSchema>

export const eliminarMediaSchema = z.object({
  media_id: z.string().uuid(),
})
export type EliminarMediaInput = z.infer<typeof eliminarMediaSchema>

export const etiquetarSchema = z.object({
  media_id: z.string().uuid(),
  // El gate de permiso (puede_aparecer_en_fotos) lo aplica la RLS + la query del selector.
  nino_id: z.string().uuid('fotos.validation.nino_invalido'),
})
export type EtiquetarInput = z.infer<typeof etiquetarSchema>

export const desetiquetarSchema = etiquetarSchema
export type DesetiquetarInput = z.infer<typeof desetiquetarSchema>

/**
 * Validación del campo de subida (route handler). El `publicacion_id` y el MIME
 * declarado llegan en el form-data; el resto (tamaño, nº de fotos, binario real)
 * se valida en el handler.
 */
export const subirFotoSchema = z.object({
  publicacion_id: z.string().uuid(),
  mime: z.enum(MIME_FOTO_ENTRADA, { message: 'fotos.validation.tipo_no_permitido' }),
})
export type SubirFotoInput = z.infer<typeof subirFotoSchema>
