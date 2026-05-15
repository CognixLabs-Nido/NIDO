import { z } from 'zod'

// --- Helpers ------------------------------------------------------------------
const horaSchema = z.string().regex(/^\d{2}:\d{2}$/, 'agenda.validation.hora_invalida')
const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'agenda.validation.fecha_invalida')
const observacionesSchema = z.string().max(500, 'agenda.validation.observaciones_largas')

// --- ENUMs --------------------------------------------------------------------
export const estadoGeneralEnum = z.enum(['bien', 'regular', 'mal', 'mixto'])
export const humorEnum = z.enum(['feliz', 'tranquilo', 'inquieto', 'triste', 'cansado'])
export const momentoComidaEnum = z.enum(['desayuno', 'media_manana', 'comida', 'merienda'])
export const cantidadComidaEnum = z.enum(['todo', 'mayoria', 'mitad', 'poco', 'nada'])
export const tipoBiberonEnum = z.enum(['materna', 'formula', 'agua', 'infusion', 'zumo'])
export const calidadSuenoEnum = z.enum(['profundo', 'tranquilo', 'intermitente', 'nada'])
export const tipoDeposicionEnum = z.enum(['pipi', 'caca', 'mixto'])
export const consistenciaDeposicionEnum = z.enum(['normal', 'dura', 'blanda', 'diarrea'])
export const cantidadDeposicionEnum = z.enum(['mucha', 'normal', 'poca'])

export type EstadoGeneral = z.infer<typeof estadoGeneralEnum>
export type Humor = z.infer<typeof humorEnum>
export type MomentoComida = z.infer<typeof momentoComidaEnum>
export type CantidadComida = z.infer<typeof cantidadComidaEnum>
export type TipoBiberon = z.infer<typeof tipoBiberonEnum>
export type CalidadSueno = z.infer<typeof calidadSuenoEnum>
export type TipoDeposicion = z.infer<typeof tipoDeposicionEnum>
export type ConsistenciaDeposicion = z.infer<typeof consistenciaDeposicionEnum>
export type CantidadDeposicion = z.infer<typeof cantidadDeposicionEnum>

// --- Cabecera (1 por nino/fecha) ---------------------------------------------
export const agendaCabeceraInputSchema = z.object({
  nino_id: z.string().uuid(),
  fecha: fechaSchema,
  estado_general: estadoGeneralEnum.nullable(),
  humor: humorEnum.nullable(),
  observaciones_generales: observacionesSchema.nullable(),
})

export type AgendaCabeceraInput = z.infer<typeof agendaCabeceraInputSchema>

// --- Comida -------------------------------------------------------------------
// Schema del FORM: solo lo que el usuario rellena. `agenda_id` lo deriva el
// server desde (nino_id, fecha) y `id` (opcional) distingue INSERT vs UPDATE.
export const comidaInputSchema = z.object({
  id: z.string().uuid().optional(),
  momento: momentoComidaEnum,
  hora: horaSchema.nullable(),
  cantidad: cantidadComidaEnum,
  descripcion: observacionesSchema.nullable(),
  observaciones: observacionesSchema.nullable(),
})

export type ComidaInput = z.infer<typeof comidaInputSchema>

// --- Biberón ------------------------------------------------------------------
export const biberonInputSchema = z.object({
  id: z.string().uuid().optional(),
  hora: horaSchema,
  cantidad_ml: z.coerce
    .number()
    .int()
    .min(0, 'agenda.validation.ml_min')
    .max(500, 'agenda.validation.ml_max'),
  tipo: tipoBiberonEnum,
  tomado_completo: z.boolean().default(true),
  observaciones: observacionesSchema.nullable(),
})

export type BiberonInput = z.infer<typeof biberonInputSchema>

// --- Sueño --------------------------------------------------------------------
export const suenoInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    hora_inicio: horaSchema,
    hora_fin: horaSchema.nullable(),
    calidad: calidadSuenoEnum.nullable(),
    observaciones: observacionesSchema.nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.hora_fin && v.hora_fin <= v.hora_inicio) {
      ctx.addIssue({
        code: 'custom',
        path: ['hora_fin'],
        message: 'agenda.validation.sueno_fin_anterior',
      })
    }
  })

export type SuenoInput = z.infer<typeof suenoInputSchema>

// --- Deposición ---------------------------------------------------------------
export const deposicionInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    hora: horaSchema.nullable(),
    tipo: tipoDeposicionEnum,
    consistencia: consistenciaDeposicionEnum.nullable(),
    cantidad: cantidadDeposicionEnum,
    observaciones: observacionesSchema.nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.tipo === 'pipi' && v.consistencia) {
      ctx.addIssue({
        code: 'custom',
        path: ['consistencia'],
        message: 'agenda.validation.consistencia_solo_caca',
      })
    }
  })

export type DeposicionInput = z.infer<typeof deposicionInputSchema>

// --- Tablas de evento que admiten "marcar como erróneo" -----------------------
export const tablaEventoEnum = z.enum(['comidas', 'biberones', 'suenos', 'deposiciones'])
export type TablaEvento = z.infer<typeof tablaEventoEnum>

// Detecta si un valor de `observaciones` ya tiene el prefijo de anulado.
export const PREFIX_ANULADO = '[anulado] '
export function esAnulado(observaciones: string | null | undefined): boolean {
  return Boolean(observaciones && observaciones.startsWith(PREFIX_ANULADO))
}
