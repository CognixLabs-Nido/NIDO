import { z } from 'zod'

// --- ENUM -------------------------------------------------------------------
export const recordatorioDestinatarioEnum = z.enum(['familia', 'equipo', 'direccion', 'personal'])
export type RecordatorioDestinatarioInput = z.infer<typeof recordatorioDestinatarioEnum>

// --- Helpers comunes --------------------------------------------------------
// Límite de input REAL del título = 200, SIN contar el prefijo `[anulado] `
// (10 chars) que el server action añade al anular. El CHECK BD permite 210.
const tituloSchema = z
  .string()
  .trim()
  .min(1, 'recordatorios.validation.titulo_vacio')
  .max(200, 'recordatorios.validation.titulo_largo')

const descripcionSchema = z.string().trim().max(1000, 'recordatorios.validation.descripcion_larga')

// --- Crear ------------------------------------------------------------------
// Cross-field: familia/equipo exigen nino_id; direccion/personal lo prohíben.
// El `centro_id` lo resuelve el server action (no viene del cliente): para
// familia/equipo se deriva del niño; para direccion/personal, del centro del
// usuario autenticado.
export const crearRecordatorioSchema = z
  .object({
    destinatario: recordatorioDestinatarioEnum,
    nino_id: z.string().uuid().nullable().optional(),
    titulo: tituloSchema,
    descripcion: descripcionSchema.nullable().optional(),
    // ISO 8601 con offset (ej. '2026-06-05T09:00:00.000Z'). null = sin fecha.
    vencimiento: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    const esNinoCentrico = v.destinatario === 'familia' || v.destinatario === 'equipo'
    if (esNinoCentrico && !v.nino_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['nino_id'],
        message: 'recordatorios.validation.nino_requerido',
      })
    }
    if (!esNinoCentrico && v.nino_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['nino_id'],
        message: 'recordatorios.validation.nino_no_permitido',
      })
    }
  })

export type CrearRecordatorioInput = z.input<typeof crearRecordatorioSchema>
export type CrearRecordatorioParsed = z.output<typeof crearRecordatorioSchema>

// --- Completar / anular -----------------------------------------------------
export const completarRecordatorioSchema = z.object({
  recordatorio_id: z.string().uuid(),
})

export const anularRecordatorioSchema = z.object({
  recordatorio_id: z.string().uuid(),
})
