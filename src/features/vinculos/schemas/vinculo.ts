import { z } from 'zod'

export const tipoVinculoEnum = z.enum([
  'tutor_legal_principal',
  'tutor_legal_secundario',
  'autorizado',
])
export const parentescoEnum = z.enum([
  'madre',
  'padre',
  'abuela',
  'abuelo',
  'tia',
  'tio',
  'hermana',
  'hermano',
  'cuidadora',
  'otro',
])

export const PERMISOS_KEYS = [
  'puede_recoger',
  'puede_ver_agenda',
  'puede_ver_fotos',
  'puede_ver_info_medica',
  'puede_recibir_mensajes',
  'puede_firmar_autorizaciones',
  'puede_confirmar_eventos',
] as const

export type PermisoKey = (typeof PERMISOS_KEYS)[number]

export function permisosDefault(
  tipo: 'tutor_legal_principal' | 'tutor_legal_secundario' | 'autorizado'
): Record<PermisoKey, boolean> {
  const habilitado = tipo === 'autorizado' ? false : true
  return Object.fromEntries(PERMISOS_KEYS.map((k) => [k, habilitado])) as Record<
    PermisoKey,
    boolean
  >
}

export const crearVinculoSchema = z
  .object({
    usuario_id: z.string().uuid('vinculo.validation.usuario_invalido'),
    tipo_vinculo: tipoVinculoEnum,
    parentesco: parentescoEnum,
    descripcion_parentesco: z.string().max(120).optional().nullable(),
  })
  .refine((d) => (d.parentesco === 'otro' ? !!d.descripcion_parentesco : true), {
    message: 'vinculo.validation.descripcion_requerida',
    path: ['descripcion_parentesco'],
  })

export type CrearVinculoInput = z.infer<typeof crearVinculoSchema>
