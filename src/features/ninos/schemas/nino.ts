import { z } from 'zod'

import { dniNieValido } from '@/features/alta/lib/documento-identidad'
import { sipValido } from '@/features/cambios-pendientes/lib/diff'

const fechaRegex = /^\d{4}-\d{2}-\d{2}$/

export const ninoSchema = z.object({
  nombre: z.string().min(1, 'nino.validation.nombre_requerido').max(80),
  // Dos apellidos (5a, `20270112120000`): el primero obligatorio, el segundo si lo tiene. Nadie
  // los parte: `apellidos` la deriva la base de los dos.
  primer_apellido: z.string().trim().min(1, 'nino.validation.apellidos_requeridos').max(80),
  segundo_apellido: z.string().trim().max(80).optional().nullable(),
  fecha_nacimiento: z
    .string()
    .regex(fechaRegex, 'nino.validation.fecha_formato')
    .refine((d) => new Date(d) <= new Date(), { message: 'nino.validation.fecha_futura' }),
  sexo: z.enum(['F', 'M', 'X']).optional().nullable(),
  nacionalidad: z.string().max(60).optional().nullable(),
  idioma_principal: z.enum(['es', 'en', 'va']),
  notas_admin: z.string().max(1000).optional().nullable(),
})

export const infoMedicaSchema = z.object({
  alergias_graves: z.string().max(2000).optional().nullable(),
  notas_emergencia: z.string().max(2000).optional().nullable(),
  medicacion_habitual: z.string().max(2000).optional().nullable(),
  alergias_leves: z.string().max(2000).optional().nullable(),
  medico_familia: z.string().max(120).optional().nullable(),
  telefono_emergencia: z.string().max(30).optional().nullable(),
})

// Pieza 3a — escritura del TUTOR. Identidad del niño (whitelist: SIN aula/centro/
// flags/notas_admin → esas las fija la dirección). La RPC SECURITY DEFINER enforce
// el gate `es_tutor_de`; el schema valida forma server-side.
/** Los códigos de «cómo nos has conocido» (lista cerrada; los mismos que el CHECK `ninos_como_nos_conocio`). */
export const COMO_NOS_CONOCIO = [
  'internet',
  'redes_sociales',
  'recomendacion',
  'paso_por_delante',
  'otro',
] as const

const textoOpcional = (max: number) => z.string().trim().max(max).optional().nullable()

/**
 * El objeto sin reglas cruzadas: `PasoMenor` lo extiende con la dirección (en Zod 4 un esquema
 * con refinamientos no se extiende). Las reglas cruzadas van en `reglasNinoTutor`, y las dos
 * formas (`actualizarNinoTutorSchema` y el formulario) las aplican.
 *
 * Fase 5b (decidido por el responsable el 2026-11-10): obligatorios el lugar de nacimiento, la
 * nacionalidad y los hermanos; el resto, opcional. Los límites son los de los CHECK de la 5a.
 */
export const actualizarNinoTutorObject = z.object({
  nino_id: z.string().uuid(),
  nombre: z.string().min(1, 'nino.validation.nombre_requerido').max(80),
  // Dos apellidos (5a, `20270112120000`): el primero obligatorio, el segundo si lo tiene. Nadie
  // los parte: `apellidos` la deriva la base de los dos.
  primer_apellido: z.string().trim().min(1, 'nino.validation.apellidos_requeridos').max(80),
  segundo_apellido: z.string().trim().max(80).optional().nullable(),
  fecha_nacimiento: z
    .string()
    .regex(fechaRegex, 'nino.validation.fecha_formato')
    .refine((d) => new Date(d) <= new Date(), { message: 'nino.validation.fecha_futura' }),
  sexo: z.enum(['F', 'M', 'X']).optional().nullable(),
  nacionalidad: z.string().trim().min(1, 'nino.validation.nacionalidad_requerida').max(60),
  idioma_principal: z.enum(['es', 'en', 'va']),
  lugar_nacimiento: z.string().trim().min(1, 'nino.validation.lugar_requerido').max(120),
  // Opcional; si llega, DNI o NIE con su letra (la base lo vuelve a mirar: `ninos_dni_valido`).
  dni: z
    .string()
    .trim()
    .max(20)
    .refine((v) => v === '' || dniNieValido(v), 'nino.validation.dni_invalido')
    .optional()
    .nullable(),
  // Fase 7 (decidido el 2026-11-13): la tarjeta sanitaria, obligatoria y de cualquier comunidad o
  // aseguradora: solo la forma que comparten todas (la base: `ninos_sip_forma`).
  sip: z
    .string('nino.validation.sip_requerido')
    .trim()
    .min(1, 'nino.validation.sip_requerido')
    .max(40)
    .refine((v) => sipValido(v), 'nino.validation.sip_invalido'),
  // El total cuenta al niño; el lugar 1 es el mayor.
  hermanos_total: z.number('nino.validation.hermanos_requeridos').int().min(1).max(20),
  hermanos_lugar: z.number('nino.validation.hermanos_requeridos').int().min(1).max(20),
  observaciones_familia: textoOpcional(1000),
  // NULL (o ausente) = no se preguntó y se deja lo que hay; '' = se quitó la respuesta.
  como_nos_conocio: z.enum(COMO_NOS_CONOCIO).or(z.literal('')).optional().nullable(),
  como_nos_conocio_otro: textoOpcional(200),
})

/** Las reglas que cruzan campos, iguales a los CHECK `ninos_hermanos` y `ninos_como_nos_conocio`. */
export function reglasNinoTutor(
  v: {
    hermanos_total: number
    hermanos_lugar: number
    como_nos_conocio?: string | null
    como_nos_conocio_otro?: string | null
  },
  ctx: z.RefinementCtx
) {
  if (v.hermanos_lugar > v.hermanos_total)
    ctx.addIssue({
      code: 'custom',
      path: ['hermanos_lugar'],
      message: 'nino.validation.hermanos_lugar_mayor',
    })
  if (v.como_nos_conocio === 'otro' && !v.como_nos_conocio_otro?.trim())
    ctx.addIssue({
      code: 'custom',
      path: ['como_nos_conocio_otro'],
      message: 'nino.validation.como_nos_conocio_otro_requerido',
    })
}

export const actualizarNinoTutorSchema = actualizarNinoTutorObject.superRefine(reglasNinoTutor)

// Info médica del tutor: misma forma que la admin. Gateada por la RPC
// `set_info_medica_emergencia_cifrada_tutor` (solo `es_tutor_legal_de`; la info
// médica es voluntaria desde F11-F, sin gate de consentimiento).
export const infoMedicaTutorSchema = infoMedicaSchema.extend({
  nino_id: z.string().uuid(),
})

export type NinoInput = z.infer<typeof ninoSchema>
export type InfoMedicaInput = z.infer<typeof infoMedicaSchema>
export type ActualizarNinoTutorInput = z.infer<typeof actualizarNinoTutorSchema>
export type InfoMedicaTutorInput = z.infer<typeof infoMedicaTutorSchema>
