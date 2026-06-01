import { z } from 'zod'

// --- ENUM -------------------------------------------------------------------
// Modelo granular F6-C (supera el ENUM de 4 de F6-A). admin/profe emisores;
// tutor/autorizado solo reciben.
export const recordatorioDestinatarioEnum = z.enum([
  'familia_individual',
  'familias_aula',
  'familias_centro',
  'profe_individual',
  'profes_centro',
  'personal',
])
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
// Cross-field por destino:
//   - familia_individual → exige nino_id (solo).
//   - familias_aula       → exige aula_id (solo).
//   - profe_individual    → exige usuario_destinatario_id (solo).
//   - familias_centro / profes_centro / personal → ninguna referencia en el input.
// El `centro_id` lo resuelve el server action (no viene del cliente). En
// `personal`, el action fija `usuario_destinatario_id = auth.uid()`.
export const crearRecordatorioSchema = z
  .object({
    destinatario: recordatorioDestinatarioEnum,
    nino_id: z.string().uuid().nullable().optional(),
    aula_id: z.string().uuid().nullable().optional(),
    usuario_destinatario_id: z.string().uuid().nullable().optional(),
    titulo: tituloSchema,
    descripcion: descripcionSchema.nullable().optional(),
    // ISO 8601 con offset (ej. '2026-06-05T09:00:00.000Z'). null = sin fecha.
    vencimiento: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    // nino_id ↔ familia_individual
    if (v.destinatario === 'familia_individual' && !v.nino_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['nino_id'],
        message: 'recordatorios.validation.nino_requerido',
      })
    }
    if (v.destinatario !== 'familia_individual' && v.nino_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['nino_id'],
        message: 'recordatorios.validation.nino_no_permitido',
      })
    }
    // aula_id ↔ familias_aula
    if (v.destinatario === 'familias_aula' && !v.aula_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['aula_id'],
        message: 'recordatorios.validation.aula_requerida',
      })
    }
    if (v.destinatario !== 'familias_aula' && v.aula_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['aula_id'],
        message: 'recordatorios.validation.aula_no_permitida',
      })
    }
    // usuario_destinatario_id ↔ profe_individual (en personal lo fija el action)
    if (v.destinatario === 'profe_individual' && !v.usuario_destinatario_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['usuario_destinatario_id'],
        message: 'recordatorios.validation.profe_requerida',
      })
    }
    if (v.destinatario !== 'profe_individual' && v.usuario_destinatario_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['usuario_destinatario_id'],
        message: 'recordatorios.validation.usuario_no_permitido',
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
