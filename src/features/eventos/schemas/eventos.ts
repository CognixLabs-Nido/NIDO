import { z } from 'zod'

// --- ENUMs (F7, decisiones D1/D3/D9) ----------------------------------------
export const ambitoEventoEnum = z.enum(['centro', 'aula', 'nino'])
export const tipoEventoEnum = z.enum(['excursion', 'reunion', 'fiesta', 'vacaciones', 'otro'])
export const confirmacionEstadoEnum = z.enum(['confirmado', 'rechazado'])

const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'eventos.validation.fecha_invalida')
const horaSchema = z.string().regex(/^\d{2}:\d{2}$/, 'eventos.validation.hora_invalida')

const tituloSchema = z
  .string()
  .trim()
  .min(1, 'eventos.validation.titulo_vacio')
  .max(200, 'eventos.validation.titulo_largo')

const descripcionSchema = z.string().trim().max(2000, 'eventos.validation.descripcion_larga')
const lugarSchema = z.string().trim().max(200, 'eventos.validation.lugar_largo')

// Campos comunes a crear/editar. El `ambito`/`aula_id`/`nino_id` solo se fijan al
// crear (la audiencia no se edita); editar solo toca contenido y fechas.
const baseEventoFields = {
  tipo: tipoEventoEnum,
  titulo: tituloSchema,
  descripcion: descripcionSchema.nullable().optional(),
  lugar: lugarSchema.nullable().optional(),
  fecha: fechaSchema,
  fecha_fin: fechaSchema.nullable().optional(),
  hora_inicio: horaSchema.nullable().optional(),
  hora_fin: horaSchema.nullable().optional(),
  requiere_confirmacion: z.boolean().default(false),
}

/** Rango y horas coherentes (mismas reglas que el CHECK de BD). */
function checkFechasYHoras(
  v: {
    fecha: string
    fecha_fin?: string | null
    hora_inicio?: string | null
    hora_fin?: string | null
  },
  ctx: z.RefinementCtx
): void {
  if (v.fecha_fin && v.fecha_fin < v.fecha) {
    ctx.addIssue({
      code: 'custom',
      path: ['fecha_fin'],
      message: 'eventos.validation.rango_invalido',
    })
  }
  // fin > inicio solo si misma fecha (sin rango) y ambas horas presentes.
  if (!v.fecha_fin && v.hora_inicio && v.hora_fin && v.hora_fin <= v.hora_inicio) {
    ctx.addIssue({
      code: 'custom',
      path: ['hora_fin'],
      message: 'eventos.validation.hora_fin_invalida',
    })
  }
}

// --- Crear ------------------------------------------------------------------
// Cross-field por ámbito (espejo del CHECK eventos_ambito_coherencia):
//   nino   → exige nino_id (solo).
//   aula   → exige aula_id (solo).
//   centro → ninguna referencia.
// El `centro_id` lo resuelve el server action (no viene del cliente).
export const crearEventoSchema = z
  .object({
    ambito: ambitoEventoEnum,
    aula_id: z.string().uuid().nullable().optional(),
    nino_id: z.string().uuid().nullable().optional(),
    ...baseEventoFields,
  })
  .superRefine((v, ctx) => {
    if (v.ambito === 'nino' && !v.nino_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['nino_id'],
        message: 'eventos.validation.nino_requerido',
      })
    }
    if (v.ambito !== 'nino' && v.nino_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['nino_id'],
        message: 'eventos.validation.nino_no_permitido',
      })
    }
    if (v.ambito === 'aula' && !v.aula_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['aula_id'],
        message: 'eventos.validation.aula_requerida',
      })
    }
    if (v.ambito !== 'aula' && v.aula_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['aula_id'],
        message: 'eventos.validation.aula_no_permitida',
      })
    }
    checkFechasYHoras(v, ctx)
  })

export type CrearEventoInput = z.input<typeof crearEventoSchema>
export type CrearEventoParsed = z.output<typeof crearEventoSchema>

// --- Editar (no cambia ámbito/audiencia) ------------------------------------
export const editarEventoSchema = z
  .object({
    evento_id: z.string().uuid(),
    ...baseEventoFields,
  })
  .superRefine((v, ctx) => {
    checkFechasYHoras(v, ctx)
  })

export type EditarEventoInput = z.input<typeof editarEventoSchema>

// --- Cancelar ---------------------------------------------------------------
export const cancelarEventoSchema = z.object({
  evento_id: z.string().uuid(),
})

// --- Confirmar asistencia (D2/D9) -------------------------------------------
export const confirmarAsistenciaSchema = z.object({
  evento_id: z.string().uuid(),
  nino_id: z.string().uuid(),
  estado: confirmacionEstadoEnum,
  comentario: z
    .string()
    .trim()
    .max(500, 'eventos.validation.comentario_largo')
    .nullable()
    .optional(),
})

export type ConfirmarAsistenciaInput = z.input<typeof confirmarAsistenciaSchema>
