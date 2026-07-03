import { z } from 'zod'

import { passwordSchema } from '@/features/auth/schemas/password'
import { parentescoEnum } from '@/features/vinculos/schemas/vinculo'

const uuid = z.string().uuid('listaEspera.validation.id_invalido')

/** Campos comunes del prospecto (alta y edición). */
const camposProspecto = {
  nombre_nino: z
    .string()
    .trim()
    .min(1, 'listaEspera.validation.nombre_requerido')
    .max(120, 'listaEspera.validation.nombre_largo'),
  // Apellidos separados del nombre (PR-4c-1). Obligatorio en el formulario para datos
  // limpios; la columna en BD es nullable solo por los prospectos previos a esta columna.
  apellidos_nino: z
    .string()
    .trim()
    .min(1, 'listaEspera.validation.apellidos_requerido')
    .max(120, 'listaEspera.validation.apellidos_largo'),
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

export const invitarAlAltaSchema = z.object({
  id: uuid,
  // Aula (física) del curso activo contra la que se crea la matrícula pendiente.
  aulaId: z.string().uuid('listaEspera.validation.aula_invalida'),
})
export type InvitarAlAltaInput = z.infer<typeof invitarAlAltaSchema>

/**
 * Modo "Completa Dirección" (PR-3a): la Dirección crea el alta en nombre del tutor sin
 * enviar email. Además del aula (como al invitar) pide las credenciales que la Dirección
 * fija para el tutor (email + contraseña provisional, mismas reglas que el registro) y el
 * parentesco del vínculo familiar. `descripcionParentesco` es obligatorio si parentesco='otro'.
 */
export const completarDireccionSchema = z
  .object({
    id: uuid,
    aulaId: z.string().uuid('listaEspera.validation.aula_invalida'),
    // Nombre y apellidos REALES del tutor (los teclea la Dirección): el email no guarda
    // relación con el nombre, así que no se deriva de él. Obligatorios → nunca hay fallback.
    nombreTutor: z
      .string()
      .trim()
      .min(1, 'listaEspera.validation.nombre_tutor_requerido')
      .max(80, 'listaEspera.validation.nombre_tutor_largo'),
    apellidosTutor: z
      .string()
      .trim()
      .min(1, 'listaEspera.validation.apellidos_tutor_requerido')
      .max(80, 'listaEspera.validation.apellidos_tutor_largo'),
    email: z.string().trim().email('listaEspera.validation.email_invalido'),
    password: passwordSchema,
    parentesco: parentescoEnum,
    descripcionParentesco: z.string().trim().max(120).optional().nullable(),
  })
  .refine((d) => (d.parentesco === 'otro' ? !!d.descripcionParentesco : true), {
    message: 'vinculo.validation.descripcion_requerida',
    path: ['descripcionParentesco'],
  })
export type CompletarDireccionInput = z.infer<typeof completarDireccionSchema>

export const reordenarListaEsperaSchema = z.object({
  curso_academico_id: uuid,
  /** Ids en el nuevo orden; `posicion` se persiste como índice + 1. */
  orden: z.array(uuid).min(1, 'listaEspera.validation.orden_vacio'),
})
export type ReordenarListaEsperaInput = z.infer<typeof reordenarListaEsperaSchema>
