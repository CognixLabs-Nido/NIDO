import { z } from 'zod'

// --- Result pattern (idéntico al resto de features) -------------------------
export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

export function fail(error: string): ActionResult<never> {
  return { success: false, error }
}

/** Por qué la titular mira lo bloqueado (CHECK de `accesos_datos_bloqueados.motivo_tipo`). */
export const MOTIVOS_TIPO = [
  'agencia_tributaria',
  'juzgado',
  'reclamacion',
  'proteccion_datos',
  'otro',
] as const
export type MotivoTipo = (typeof MOTIVOS_TIPO)[number]

/** Los apartados de `privado.contenido_bloqueado`, en el orden en que se enseñan. */
export const APARTADOS = [
  'firmas',
  'autorizaciones',
  'consentimientos',
  'acuses_alta',
  'medicacion_administrada',
  'lecturas_ficha_medica',
] as const

export const MOTIVO_MIN = 10
export const MOTIVO_MAX = 1000

export const VerDatosBloqueadosSchema = z.object({
  centroId: z.string().uuid(),
  sujetoTipo: z.enum(['nino', 'usuario']),
  sujetoId: z.string().uuid(),
  motivoTipo: z.enum(MOTIVOS_TIPO),
  motivo: z.string().trim().min(MOTIVO_MIN).max(MOTIVO_MAX),
  accion: z.enum(['ver', 'descargar']),
})
export type VerDatosBloqueadosInput = z.infer<typeof VerDatosBloqueadosSchema>

export type Fila = Record<string, unknown>

/** Lo que devuelve `ver_datos_bloqueados`: desde cuándo y las filas de cada apartado. */
export interface ContenidoBloqueado {
  bloqueadoDesde: string | null
  apartados: Record<string, Fila[]>
}
