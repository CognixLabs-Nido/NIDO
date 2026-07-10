import { z } from 'zod'

/** Estados civiles (espejo del ENUM `estado_civil` de la migración G-0). */
export const estadoCivilEnum = z.enum([
  'casados',
  'separados',
  'divorciados',
  'pareja_de_hecho',
  'soltero',
  'viudo',
])

export const tipoVinculoLegalEnum = z.enum(['tutor_legal_principal', 'tutor_legal_secundario'])

/** Rol en el perfil compartido de `familia_tutores` (espejo del CHECK de F-0). */
export const rolFamiliaEnum = z.enum(['titular', 'segundo_tutor'])
export type RolFamilia = z.infer<typeof rolFamiliaEnum>

/**
 * Mapeo ÚNICO tipo_vinculo (por-niño, legado `datos_tutor`) ↔ rol_familia (perfil
 * compartido `familia_tutores`). Todo el wizard/cola escribe y lee por este par:
 * `tutor_legal_principal`⇄`titular`, `tutor_legal_secundario`⇄`segundo_tutor`.
 */
export function rolFamiliaDeVinculo(tv: z.infer<typeof tipoVinculoLegalEnum>): RolFamilia {
  return tv === 'tutor_legal_principal' ? 'titular' : 'segundo_tutor'
}
export function vinculoDeRolFamilia(rol: RolFamilia): z.infer<typeof tipoVinculoLegalEnum> {
  return rol === 'titular' ? 'tutor_legal_principal' : 'tutor_legal_secundario'
}

/** Bloque de dirección reutilizado por menor y tutores (longitudes = CHECK de G-0). */
const direccionFields = {
  direccion_calle: z.string().max(200).optional().nullable(),
  direccion_numero: z.string().max(20).optional().nullable(),
  direccion_cp: z.string().max(12).optional().nullable(),
  direccion_ciudad: z.string().max(120).optional().nullable(),
}

/**
 * Escritura del TUTOR sobre las columnas nuevas de `ninos` (dirección del menor +
 * estado civil de la familia). La tabla `ninos` es admin-only por RLS y la RPC
 * `actualizar_identidad_nino_tutor` no whitelistea estas columnas → la action autoriza
 * `es_tutor_legal_de` y escribe con service role (patrón legacy de `ninos.foto_url`).
 */
export const actualizarNinoFamiliaSchema = z.object({
  nino_id: z.string().uuid(),
  ...direccionFields,
  estado_civil_familia: estadoCivilEnum.optional().nullable(),
})

/**
 * Datos del tutor (identidad + dirección) en el alta. tutor 1 = principal (usuario_id
 * = auth.uid()); tutor 2 = secundario sin cuenta (usuario_id NULL, la invitación llega
 * en G-3). El DNI (PDF) NO viaja aquí: lo sube su ruta y fija `dni_documento_path`.
 */
export const guardarDatosTutorSchema = z.object({
  nino_id: z.string().uuid(),
  tipo_vinculo: tipoVinculoLegalEnum,
  email: z.string().email('alta.documentos.errors.email').max(255).optional().nullable(),
  nombre_completo: z
    .string()
    .min(2, 'alta.documentos.errors.nombre')
    .max(120)
    .optional()
    .nullable(),
  ...direccionFields,
})

export type ActualizarNinoFamiliaInput = z.infer<typeof actualizarNinoFamiliaSchema>
export type GuardarDatosTutorInput = z.infer<typeof guardarDatosTutorSchema>
export type EstadoCivil = z.infer<typeof estadoCivilEnum>
export type TipoVinculoLegal = z.infer<typeof tipoVinculoLegalEnum>
