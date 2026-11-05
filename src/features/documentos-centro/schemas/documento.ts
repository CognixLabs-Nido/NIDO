import { z } from 'zod'

/** El título (J7): en un idioma, de 1 a 200 caracteres, como el CHECK de la tabla (1a). */
const titulo = z.string().trim().min(1).max(200)
/** El orden en la lista: de 0 a 1000, como el CHECK de la tabla. */
const orden = z.number().int().min(0).max(1000)

export const crearDocumentoSchema = z.object({
  centroId: z.string().uuid(),
  titulo,
  deCurso: z.boolean(),
  obligatorio: z.boolean(),
  orden,
})
export type CrearDocumentoInput = z.infer<typeof crearDocumentoSchema>

export const editarDocumentoSchema = z.object({
  documentoId: z.string().uuid(),
  titulo: titulo.optional(),
  deCurso: z.boolean().optional(),
  obligatorio: z.boolean().optional(),
  orden: orden.optional(),
  retirado: z.boolean().optional(),
})
export type EditarDocumentoInput = z.infer<typeof editarDocumentoSchema>

/** Lo que edita el formulario del documento (la pantalla, 1c). */
export const formularioDocumentoSchema = z.object({
  titulo,
  deCurso: z.boolean(),
  obligatorio: z.boolean(),
  orden,
})
export type FormularioDocumento = z.infer<typeof formularioDocumentoSchema>
