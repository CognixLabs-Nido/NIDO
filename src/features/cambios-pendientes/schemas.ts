import { z } from 'zod'

import { estadoCivilEnum, tipoVinculoLegalEnum } from '@/features/alta/schemas/alta-documentos'

/**
 * F11-G-3 (decisión J) — cola de ediciones del tutor pendientes de validación por la
 * dirección. Define QUÉ datos sensibles disparan validación cuando el alta YA está validada
 * (matrícula `'activa'`): dirección/estado civil del menor, libro de familia, identidad/
 * dirección del tutor y DNI del tutor, y desde la puerta de identidad (2026-11-08,
 * `20270113120000`) los ocho campos que identifican al niño: nombre, los dos apellidos, fecha y
 * lugar de nacimiento, sexo, nacionalidad y DNI. Hasta entonces la identidad del niño se aplicaba
 * directa con el alta validada; decisión J la dejaba fuera de la cola, y se cierra aquí. Siguen
 * directos el idioma, los hermanos, las observaciones y cómo nos conoció (decidido el
 * 2026-11-07), y los pedagógicos, el médico cifrado, la autorización de imagen y el mandato SEPA,
 * que se gobiernan por sus propios mecanismos.
 *
 * Solo se encola lo que CAMBIA respecto a lo guardado (`lib/diff.ts`): una entrada que no cambia
 * nada enseña a aprobar sin mirar.
 *
 * `entidad` identifica el destino lógico; `payload` lleva el cambio propuesto (parche de
 * datos, o `{ path }` del documento ya subido a un objeto staged que se confirma al aprobar).
 */
export const entidadCambioEnum = z.enum([
  'ninos_familia',
  'ninos_libro_familia',
  'datos_tutor',
  'datos_tutor_dni',
  'ninos_identidad',
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

/**
 * Los campos de identidad del niño que cambian (puerta de identidad, 2026-11-08), ya normalizados
 * como los guarda la base. `strict`: la entrada la escribe el tutor, y al aprobar se aplica con la
 * sesión de la directora; una clave que no sea de las ocho no se aplica nunca.
 */
export const payloadNinosIdentidadSchema = z
  .object({
    nombre: z.string().min(1).max(80).optional(),
    primer_apellido: z.string().min(1).max(80).optional(),
    segundo_apellido: z.string().min(1).max(80).nullable().optional(),
    fecha_nacimiento: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    sexo: z.enum(['F', 'M', 'X']).optional(),
    nacionalidad: z.string().min(1).max(60).optional(),
    lugar_nacimiento: z.string().min(1).max(120).nullable().optional(),
    dni: z.string().min(1).max(20).nullable().optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'sin_cambios' })

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

/**
 * R1/R1b — ¿la ruta del documento staged es del niño de la fila? Tiene que ser exactamente
 * `{centroId}/{ninoId}/<nombre>.pdf` con un único segmento final (sin `/` ni `..`), que es lo
 * que construyen las rutas de subida legítimas. `centroId`/`ninoId` salen de la FILA de
 * `cambios_pendientes` (el trigger fija `centro_id` desde el niño), nunca del payload.
 * Espejo del CHECK `cambios_pendientes_ruta_documento_del_nino`.
 */
export function rutaDocumentoDelNino(path: string, centroId: string, ninoId: string): boolean {
  const prefijo = `${centroId}/${ninoId}/`
  return path.startsWith(prefijo) && /^[A-Za-z0-9_-]+\.pdf$/.test(path.slice(prefijo.length))
}

export type PayloadNinosFamilia = z.infer<typeof payloadNinosFamiliaSchema>
export type PayloadDocumento = z.infer<typeof payloadDocumentoSchema>
export type PayloadDatosTutor = z.infer<typeof payloadDatosTutorSchema>
export type PayloadDatosTutorDni = z.infer<typeof payloadDatosTutorDniSchema>
export type PayloadNinosIdentidad = z.infer<typeof payloadNinosIdentidadSchema>

/** Etiqueta i18n para mostrar el tipo de cambio en la cola del admin. */
export const ETIQUETA_ENTIDAD: Record<EntidadCambio, string> = {
  ninos_familia: 'admin.pendientes.entidad.ninos_familia',
  ninos_libro_familia: 'admin.pendientes.entidad.ninos_libro_familia',
  datos_tutor: 'admin.pendientes.entidad.datos_tutor',
  datos_tutor_dni: 'admin.pendientes.entidad.datos_tutor_dni',
  ninos_identidad: 'admin.pendientes.entidad.ninos_identidad',
}
