/**
 * Centro de notificaciones in-app (C1, sin migración): feed DERIVADO de novedades
 * por rol/ámbito + un único marcador "visto" por usuario en `preferencias_usuario`.
 * No hay tabla propia; la RLS de cada tabla origen (eventos, autorizaciones,
 * administraciones_medicacion) filtra el ámbito del rol automáticamente.
 */

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

export function fail(error: string): ActionResult<never> {
  return { success: false, error }
}

/** Clave del marcador "todo lo anterior está visto" en preferencias_usuario. */
export const PREF_NOTIF_VISTO = 'notificaciones_visto_at'

/**
 * Clave del mapa por-autorización `{ [autorizacion_id]: iso_visto_at }` en
 * preferencias_usuario: registra cuándo el usuario ABRIÓ cada autorización. El
 * aviso de "nueva firma" del panel deja de contar las firmas cuya autorización se
 * abrió después de firmarse (al abrirla, su aviso desaparece). KV, sin migración.
 */
export const PREF_FIRMAS_VISTAS = 'autorizaciones_firmas_vistas'

/** Ventana de novedades: solo se muestran/cuentan ítems de los últimos N días. */
export const VENTANA_NOVEDADES_DIAS = 30

export type NovedadTipo =
  | 'evento'
  | 'recogida'
  | 'medicacion'
  | 'autorizacion'
  | 'administracion'
  | 'revocacion'

/** Un ítem del feed de novedades, normalizado desde su tabla origen. */
export interface NovedadItem {
  /** Único en el feed (prefijado por origen para evitar colisiones de id). */
  key: string
  tipo: NovedadTipo
  titulo: string
  subtitulo?: string
  /** ISO timestamp (created_at del origen): ordena el feed y decide `nuevo`. */
  fecha: string
  href: string
  /** created_at posterior al marcador `visto_at` (o sin marcador) → no leído. */
  nuevo: boolean
  /** Administración pendiente de la confirmación del usuario actual (destacar). */
  pendienteConfirmacion?: boolean
}

/** Contadores del aviso de inicio (punto 2) — resumen de estado, según rol. */
export interface AvisosInicio {
  /** Staff: administraciones pendientes de TU confirmación (lo principal, B). */
  pendientesConfirmar: number
  /** Familia: autorizaciones firmables aún pendientes de tu firma. */
  pendientesFirma: number
  /** Staff: administraciones ya confirmadas (resumen de estado, punto 3). */
  confirmadas: number
  /** Familia: autorizaciones ya firmadas (resumen de estado, punto 3). */
  firmadas: number
  /** Ambos: medicaciones activas hoy (recordatorio de administrar según pauta). */
  medicacionesActivas: number
  /**
   * Staff: recogidas/medicaciones que una familia ha FIRMADO recientemente en tu
   * ámbito (aviso "ha llegado una nueva", no "pendiente de confirmar"). Excluye
   * tus propias firmas. La RLS de `firmas_autorizacion` acota profe→aula, admin→centro.
   */
  nuevasFirmas: number
  /**
   * Staff: recogidas/medicaciones REVOCADAS recientemente por una familia (alerta de
   * seguridad: cambió quién recoge / se paró una medicina). Antes vivía en el feed.
   * Excluye tus propias revocaciones; desaparece al abrir la autorización.
   */
  revocaciones: number
}
