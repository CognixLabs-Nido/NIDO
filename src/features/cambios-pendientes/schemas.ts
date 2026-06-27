import { z } from 'zod'

import { estadoCivilEnum, tipoVinculoLegalEnum } from '@/features/alta/schemas/alta-documentos'

/**
 * F11-G-3 (decisión J) — cola de ediciones del tutor pendientes de validación por la
 * dirección. Define QUÉ datos sensibles disparan validación cuando el alta YA está validada
 * (matrícula `'activa'`): dirección/estado civil del menor, libro de familia, identidad/
 * dirección del tutor y DNI del tutor. El resto (identidad nombre/fecha, pedagógicos, médico
 * cifrado, autorización de imagen, mandato SEPA) se gobierna por sus propios mecanismos y NO
 * pasa por esta cola.
 *
 * `entidad` identifica el destino lógico; `payload` lleva el cambio propuesto (parche de
 * datos, o `{ path }` del documento ya subido a un objeto staged que se confirma al aprobar).
 */
export const entidadCambioEnum = z.enum([
  'ninos_familia',
  'ninos_libro_familia',
  'datos_tutor',
  'datos_tutor_dni',
])
export type EntidadCambio = z.infer<typeof entidadCambioEnum>

/** Parche de dirección + estado civil del menor (columnas de `ninos`). */
export const payloadNinosFamiliaSchema = z.object({
  direccion_calle: z.string().max(200).nullable().optional(),
  direccion_numero: z.string().max(20).nullable().optional(),
  direccion_cp: z.string().max(12).nullable().optional(),
  direccion_ciudad: z.string().max(120).nullable().optional(),
  estado_civil_familia: estadoCivilEnum.nullable().optional(),
})

/** Documento ya subido a `libro-familia` (objeto staged); se confirma la ruta al aprobar. */
export const payloadDocumentoSchema = z.object({
  path: z.string().min(1).max(400),
})

/** Identidad + dirección de un tutor (columnas de `datos_tutor`), con su vínculo. */
export const payloadDatosTutorSchema = z.object({
  tipo_vinculo: tipoVinculoLegalEnum,
  email: z.string().email().max(255).nullable().optional(),
  nombre_completo: z.string().min(2).max(120).nullable().optional(),
  direccion_calle: z.string().max(200).nullable().optional(),
  direccion_numero: z.string().max(20).nullable().optional(),
  direccion_cp: z.string().max(12).nullable().optional(),
  direccion_ciudad: z.string().max(120).nullable().optional(),
})

/** DNI de un tutor (PDF ya subido a `dni-tutores`), con su vínculo. */
export const payloadDatosTutorDniSchema = z.object({
  tipo_vinculo: tipoVinculoLegalEnum,
  path: z.string().min(1).max(400),
})

export type PayloadNinosFamilia = z.infer<typeof payloadNinosFamiliaSchema>
export type PayloadDocumento = z.infer<typeof payloadDocumentoSchema>
export type PayloadDatosTutor = z.infer<typeof payloadDatosTutorSchema>
export type PayloadDatosTutorDni = z.infer<typeof payloadDatosTutorDniSchema>

/** Etiqueta i18n para mostrar el tipo de cambio en la cola del admin. */
export const ETIQUETA_ENTIDAD: Record<EntidadCambio, string> = {
  ninos_familia: 'admin.pendientes.entidad.ninos_familia',
  ninos_libro_familia: 'admin.pendientes.entidad.ninos_libro_familia',
  datos_tutor: 'admin.pendientes.entidad.datos_tutor',
  datos_tutor_dni: 'admin.pendientes.entidad.datos_tutor_dni',
}
