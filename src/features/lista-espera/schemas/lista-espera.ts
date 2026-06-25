import { z } from 'zod'

const uuid = z.string().uuid('listaEspera.validation.id_invalido')

/** Campos comunes del prospecto (alta y edición). */
const camposProspecto = {
  nombre_nino: z
    .string()
    .trim()
    .min(1, 'listaEspera.validation.nombre_requerido')
    .max(120, 'listaEspera.validation.nombre_largo'),
  // Inputs de tipo date/text envían ''; lo normalizamos a null (columnas nullables).
  fecha_nacimiento: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(z.string().date('listaEspera.validation.fecha_invalida').nullable()),
  telefono_tutor: z
    .string()
    .trim()
    .max(30, 'listaEspera.validation.telefono_largo')
    .optional()
    .transform((v) => (v ? v : null)),
  email_tutor: z
    .string()
    .trim()
    .max(255, 'listaEspera.validation.email_largo')
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(z.string().email('listaEspera.validation.email_invalido').nullable()),
  nota: z
    .string()
    .trim()
    .max(1000, 'listaEspera.validation.nota_larga')
    .optional()
    .transform((v) => (v ? v : null)),
}

export const crearProspectoSchema = z.object({
  curso_academico_id: uuid,
  ...camposProspecto,
})
export type CrearProspectoInput = z.input<typeof crearProspectoSchema>

export const editarProspectoSchema = z.object({
  id: uuid,
  ...camposProspecto,
})
export type EditarProspectoInput = z.input<typeof editarProspectoSchema>

export const descartarProspectoSchema = z.object({ id: uuid })
export type DescartarProspectoInput = z.infer<typeof descartarProspectoSchema>

export const invitarAlAltaSchema = z.object({ id: uuid })
export type InvitarAlAltaInput = z.infer<typeof invitarAlAltaSchema>

export const reordenarListaEsperaSchema = z.object({
  curso_academico_id: uuid,
  /** Ids en el nuevo orden; `posicion` se persiste como índice + 1. */
  orden: z.array(uuid).min(1, 'listaEspera.validation.orden_vacio'),
})
export type ReordenarListaEsperaInput = z.infer<typeof reordenarListaEsperaSchema>
