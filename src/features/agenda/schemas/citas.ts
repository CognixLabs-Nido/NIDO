import { z } from 'zod'

// --- ENUMs (F7b, decisiones AG-tipos/AG-04) ---------------------------------
export const tipoCitaEnum = z.enum([
  'reunion_familia',
  'reunion_clase',
  'reunion_claustro',
  'visita',
])
export const citaEstadoEnum = z.enum(['programada', 'cancelada'])
export const rsvpEstadoEnum = z.enum(['pendiente', 'aceptado', 'rechazado'])
/** Estado que un invitado puede fijar al responder (no puede volver a `pendiente`). */
export const rsvpRespuestaEnum = z.enum(['aceptado', 'rechazado'])
/** Vistas de la Agenda; la preferencia se persiste por usuario (AG-07). */
export const vistaAgendaEnum = z.enum(['dia', 'semana', 'mes'])
/** Grupos que el organizador puede invitar; se expanden a personas (snapshot, AG-02). */
export const grupoInvitadoEnum = z.enum(['familias_aula', 'profes_aula', 'profes_centro'])

const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'citas.validation.fecha_invalida')
const horaSchema = z.string().regex(/^\d{2}:\d{2}$/, 'citas.validation.hora_invalida')

const tituloSchema = z
  .string()
  .trim()
  .min(1, 'citas.validation.titulo_vacio')
  .max(200, 'citas.validation.titulo_largo')
const descripcionSchema = z.string().trim().max(2000, 'citas.validation.descripcion_larga')
const lugarSchema = z.string().trim().max(200, 'citas.validation.lugar_largo')
const comentarioSchema = z.string().trim().max(500, 'citas.validation.comentario_largo')

// --- Invitado (entrada del cliente) -----------------------------------------
// Una persona interna (usuario_id), un grupo a expandir, o un externo-texto.
export const invitadoInputSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('usuario'), usuario_id: z.string().uuid() }),
  z.object({ tipo: z.literal('grupo'), grupo: grupoInvitadoEnum }),
  z.object({
    tipo: z.literal('externo'),
    nombre_externo: z
      .string()
      .trim()
      .min(1, 'citas.validation.nombre_externo_vacio')
      .max(200, 'citas.validation.nombre_externo_largo'),
  }),
])
export type InvitadoInput = z.infer<typeof invitadoInputSchema>

const horaFields = {
  fecha: fechaSchema,
  hora_inicio: horaSchema,
  hora_fin: horaSchema.nullable().optional(),
}

/** hora_fin > hora_inicio (mismo CHECK que la BD). */
function checkHoras(
  v: { hora_inicio: string; hora_fin?: string | null },
  ctx: z.RefinementCtx
): void {
  if (v.hora_fin && v.hora_fin <= v.hora_inicio) {
    ctx.addIssue({
      code: 'custom',
      path: ['hora_fin'],
      message: 'citas.validation.hora_fin_invalida',
    })
  }
}

/** Coherencia tipo ↔ referencia (espejo del CHECK citas_tipo_coherencia) +
 *  coherencia tipo ↔ invitados (matriz AG-tipos). */
function checkTipoYInvitados(
  v: {
    tipo: z.infer<typeof tipoCitaEnum>
    nino_id?: string | null
    aula_id?: string | null
    invitados: InvitadoInput[]
  },
  ctx: z.RefinementCtx
): void {
  const { tipo, nino_id, aula_id, invitados } = v

  // tipo ↔ referencia.
  if (tipo === 'reunion_familia' && !nino_id) {
    ctx.addIssue({ code: 'custom', path: ['nino_id'], message: 'citas.validation.nino_requerido' })
  }
  if (tipo !== 'reunion_familia' && nino_id) {
    ctx.addIssue({
      code: 'custom',
      path: ['nino_id'],
      message: 'citas.validation.nino_no_permitido',
    })
  }
  if (tipo === 'reunion_clase' && !aula_id) {
    ctx.addIssue({ code: 'custom', path: ['aula_id'], message: 'citas.validation.aula_requerida' })
  }
  if (tipo !== 'reunion_clase' && aula_id) {
    ctx.addIssue({
      code: 'custom',
      path: ['aula_id'],
      message: 'citas.validation.aula_no_permitida',
    })
  }

  // tipo ↔ invitados (matriz). reunion_familia/clase/claustro auto-expanden por
  // tipo en el server action; visita exige al menos un invitado explícito.
  if (tipo === 'visita' && invitados.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['invitados'], message: 'citas.validation.sin_invitados' })
  }
  invitados.forEach((inv, i) => {
    if (inv.tipo === 'externo' && tipo !== 'visita') {
      ctx.addIssue({
        code: 'custom',
        path: ['invitados', i],
        message: 'citas.validation.externo_solo_visita',
      })
    }
    if (inv.tipo === 'grupo') {
      const okClase =
        tipo === 'reunion_clase' && (inv.grupo === 'familias_aula' || inv.grupo === 'profes_aula')
      const okClaustro = tipo === 'reunion_claustro' && inv.grupo === 'profes_centro'
      if (!okClase && !okClaustro) {
        ctx.addIssue({
          code: 'custom',
          path: ['invitados', i],
          message: 'citas.validation.grupo_no_permitido',
        })
      }
    }
  })
}

// --- Crear ------------------------------------------------------------------
// `centro_id` lo resuelve el server action (no viene del cliente).
export const crearCitaSchema = z
  .object({
    tipo: tipoCitaEnum,
    aula_id: z.string().uuid().nullable().optional(),
    nino_id: z.string().uuid().nullable().optional(),
    titulo: tituloSchema,
    descripcion: descripcionSchema.nullable().optional(),
    lugar: lugarSchema.nullable().optional(),
    ...horaFields,
    invitados: z.array(invitadoInputSchema).default([]),
  })
  .superRefine((v, ctx) => {
    checkHoras(v, ctx)
    checkTipoYInvitados(v, ctx)
  })

export type CrearCitaInput = z.input<typeof crearCitaSchema>
export type CrearCitaParsed = z.output<typeof crearCitaSchema>

// --- Editar (no cambia tipo/audiencia; solo contenido y fechas) -------------
export const editarCitaSchema = z
  .object({
    cita_id: z.string().uuid(),
    titulo: tituloSchema,
    descripcion: descripcionSchema.nullable().optional(),
    lugar: lugarSchema.nullable().optional(),
    ...horaFields,
  })
  .superRefine((v, ctx) => checkHoras(v, ctx))

export type EditarCitaInput = z.input<typeof editarCitaSchema>

// --- Cancelar ---------------------------------------------------------------
export const cancelarCitaSchema = z.object({ cita_id: z.string().uuid() })

// --- Responder a una invitación (RSVP del invitado interno) -----------------
export const responderInvitacionSchema = z.object({
  cita_id: z.string().uuid(),
  estado: rsvpRespuestaEnum,
  comentario: comentarioSchema.nullable().optional(),
})
export type ResponderInvitacionInput = z.input<typeof responderInvitacionSchema>

// --- Editar la lista de invitados (organizador/admin, AG-02) ----------------
export const agregarInvitadosSchema = z.object({
  cita_id: z.string().uuid(),
  invitados: z.array(invitadoInputSchema).min(1, 'citas.validation.sin_invitados'),
})
export type AgregarInvitadosInput = z.input<typeof agregarInvitadosSchema>

export const quitarInvitadoSchema = z.object({ invitado_id: z.string().uuid() })

/** El organizador marca la asistencia de un invitado externo (sin RSVP digital). */
export const marcarAsistenciaExternoSchema = z.object({
  invitado_id: z.string().uuid(),
  estado: rsvpRespuestaEnum,
})

// --- Preferencia de vista (AG-07) -------------------------------------------
export const setPreferenciaVistaAgendaSchema = z.object({ vista: vistaAgendaEnum })
