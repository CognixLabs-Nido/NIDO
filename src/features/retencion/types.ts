import type { Database } from '@/types/database'

// --- Result pattern (idéntico al resto de features) -------------------------
export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

export function fail(error: string): ActionResult<never> {
  return { success: false, error }
}

// --- Tipos de dominio (espejo de la migración A6) ---------------------------
export type RetencionCategoria = Database['public']['Enums']['retencion_categoria']
export type RetencionAccion = Database['public']['Enums']['retencion_accion']
export type RetencionEjecucionRow = Database['public']['Tables']['retencion_ejecuciones']['Row']

// -----------------------------------------------------------------------------
// PLAZOS DE RETENCIÓN — PROVISIONALES (PENDIENTE política F11-B): los fija el
// responsable, no el abogado todavía. La tabla con qué cubre cada uno, desde cuándo
// cuenta y qué se hace al vencer está en docs/specs/retencion-plazos.md, y
// `__tests__/plazos.test.ts` comprueba que estos valores son los de esa tabla.
// -----------------------------------------------------------------------------

/** Recogida PUNTUAL (válida solo el día): purga el DNI a los N días de caducar. */
export const RETENCION_RECOGIDA_PUNTUAL_DIAS = 7 // PENDIENTE política F11-B

/** Recogida HABITUAL (vigencia abierta): purga el DNI a los N meses de la baja. */
export const RETENCION_RECOGIDA_HABITUAL_MESES = 12 // PENDIENTE política F11-B

/** Fotos de menores (ficha + blog): purga a los N meses tras la baja de matrícula. */
export const RETENCION_FOTOS_MESES = 12 // PENDIENTE política F11-B

/**
 * Esqueleto huérfano (alta abandonada): purga el niño/matrícula/invitación a los N
 * días de CADUCAR la invitación (`expires_at`). Se mide desde `expires_at` porque
 * re-invitar lo resetea: una invitación aún vencida prueba que nadie la reactivó.
 */
export const GRACIA_ESQUELETO_DIAS = 30 // configurable; PENDIENTE política F11-B

/**
 * Registro de lecturas de la ficha médica (`lecturas_ficha_medica`, 20261128120000): se borran a
 * los N meses de cada lectura. 5 años, como `audit_log` (antes 24 meses, el mínimo del RD 1720/2007).
 */
export const RETENCION_LECTURAS_FICHA_MEDICA_MESES = 60 // PENDIENTE política F11-B

/**
 * Recibos, líneas, remesas y lo que justifica sus importes (parte de servicio, asignaciones,
 * beca de comedor): N años desde el último cobro de la familia (art. 30 del Código de Comercio).
 */
export const RETENCION_FISCAL_ANIOS = 6 // PENDIENTE política F11-B

/** Mandatos SEPA y su documento: N años desde el último cobro de la familia. */
export const RETENCION_MANDATOS_SEPA_ANIOS = 6 // PENDIENTE política F11-B

/**
 * Pruebas: firmas, autorizaciones de un niño, consentimientos, acuses del alta y medicación
 * administrada. N años desde la baja del niño.
 */
export const RETENCION_FIRMAS_ANIOS = 5 // PENDIENTE política F11-B

/** Expediente del niño (identidad, salud, desarrollo): N años desde la baja. */
export const RETENCION_EXPEDIENTE_ANIOS = 5 // PENDIENTE política F11-B

/**
 * La cuenta de un tutor o un autorizado en un centro: N años desde la baja de su último hijo allí,
 * si no le queda otro rol vivo (20261207120000). Se purga como en el olvido, sin que nadie lo pida.
 */
export const RETENCION_CUENTA_TUTOR_ANIOS = 5 // PENDIENTE política F11-B

/**
 * Operativa del día a día (agenda, asistencia, ausencias, informes, mensajes, citas,
 * recordatorios, confirmaciones): N años desde el final del curso en que se escribió.
 */
export const RETENCION_OPERATIVA_ANIOS = 1 // PENDIENTE política F11-B

/**
 * Las tablas por las que cuenta o borra `purgar_operativa_vencida` (20261203120000), en su orden.
 * Las hijas (las cuatro de la agenda, `lectura_conversacion`, `cita_invitados`) caen en cascada.
 * `retencion-operativa.test.ts` comprueba contra la BD que la función devuelve justo estas.
 */
export const TABLAS_OPERATIVA = [
  'agendas_diarias',
  'asistencias',
  'ausencias',
  'informes_evolucion',
  'mensajes',
  'conversaciones',
  'citas',
  'recordatorios',
  'confirmaciones_evento',
] as const

export type TablaOperativa = (typeof TABLAS_OPERATIVA)[number]

/** Lista de espera que no llegó a alta: N años desde que deja de estar viva. */
export const RETENCION_LISTA_ESPERA_ANIOS = 1 // PENDIENTE política F11-B

/** `audit_log`: N años desde cada fila (y antes, con su tabla: nada vive más en él que en ella). */
export const RETENCION_AUDIT_LOG_ANIOS = 5 // PENDIENTE política F11-B

/** Registros de los derechos atendidos (`export_log`, `olvido_solicitudes`): N años. */
export const RETENCION_REGISTROS_DERECHOS_ANIOS = 5 // PENDIENTE política F11-B

/** Una unidad de purga: 1+ objetos de Storage del mismo sujeto/categoría. */
export interface UnidadRetencion {
  categoria: RetencionCategoria
  centroId: string
  /** Tipo de referencia para la traza (sin PII). */
  refTipo: 'nino' | 'firma' | 'usuario'
  refId: string
  bucket: string
  /** Rutas de Storage a borrar (solo en purga real, no en dry-run). */
  paths: string[]
  /** Predicado que disparó la retención (traza). */
  motivo: string
}

export interface ResultadoBarrido {
  dryRun: boolean
  /** Unidades candidatas encontradas. */
  total: number
  /** Objetos de Storage purgados (0 en dry-run). */
  objetosPurgados: number
  /** Unidades que fallaron (se reintentan en la siguiente pasada). */
  fallidos: number
  porCategoria: Record<string, number>
}
