/**
 * Centro de notificaciones in-app (C1, sin migración): feed DERIVADO de novedades
 * por rol/ámbito + un único marcador "visto" por usuario en `preferencias_usuario`.
 * No hay tabla propia; la RLS de cada tabla origen (eventos, autorizaciones,
 * administraciones_medicacion) filtra el ámbito del rol automáticamente.
 */

import type { CampanaPendientesAviso } from '@/features/informes/types'

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

/**
 * Clave del mapa por-informe `{ [informe_id]: iso_visto_at }` en
 * preferencias_usuario (F9-3): registra cuándo la familia ABRIÓ cada informe
 * publicado. El aviso de "informes nuevos" deja de contar los informes ya
 * abiertos; basta con que exista la entrada (Q8: republicar tras corregir NO
 * re-avisa, así que no comparamos instantes, solo presencia). KV, sin migración.
 */
export const PREF_INFORMES_VISTOS = 'informes_vistos'

/**
 * Clave del mapa por-publicación `{ [publicacion_id]: iso_visto_at }` en
 * preferencias_usuario (F10-2): registra qué publicaciones del blog ha abierto la
 * familia (al entrar en /family/fotos se marcan todas las visibles). El aviso de
 * "publicaciones nuevas" deja de contar las ya vistas; basta la presencia (editar
 * una publicación no re-avisa — P-edición). KV, sin migración.
 */
export const PREF_FOTOS_VISTAS = 'fotos_vistas'

/**
 * Clave del mapa por-recibo `{ [recibo_id]: iso_visto_at }` en
 * preferencias_usuario (F12-B-7): registra qué recibos ha abierto/visto la familia
 * (al entrar en /family/recibos se marcan todos los visibles). El aviso de "recibos
 * nuevos" deja de contar los ya vistos; basta la presencia (mismo patrón que
 * `informes_vistos`/`fotos_vistas` — sin migración, sin tabla ni push). Cubre los
 * recibos que genera el cierre mensual: surgen como aviso en la siguiente navegación.
 */
export const PREF_RECIBOS_VISTOS = 'recibos_vistos'

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
  /**
   * Staff: medicaciones TERMINADAS (hoy > fecha_fin) aún sin archivar — recordatorio
   * de archivarlas. Solo profe/admin (la familia no archiva).
   */
  medicacionesPorArchivar: number
  /**
   * Familia: informes de evolución PUBLICADOS de sus hijos que aún no ha abierto
   * (F9-3). Aviso derivado de `informes_evolucion` (RLS → solo publicados legibles)
   * menos el marcador `informes_vistos`. Solo familia (el staff no recibe este aviso).
   */
  informesNuevos: number
  /**
   * Familia: publicaciones del blog del aula (o donde un hijo aparece etiquetado —
   * P-histórico) que aún no ha abierto (F10-2). Aviso derivado de `publicaciones`
   * (RLS → solo las visibles para esta familia con `puede_ver_fotos`) menos el
   * marcador `fotos_vistas`. Solo familia (el staff no recibe este aviso).
   */
  fotosNuevas: number
  /**
   * Familia: recibos de sus hijos que aún no ha visto (F12-B-7). Aviso derivado de
   * `recibos` (RLS → solo los de sus hijos vía `es_tutor_legal_de`) menos el marcador
   * `recibos_vistos`. Cubre los recibos generados al cerrar el mes (sin push ni email:
   * mismo patrón derivado que informes/fotos). Solo familia (el staff no lo recibe).
   */
  recibosNuevos: number
  /**
   * Staff redactor (coordinadora/profesora): informes que le faltan por completar
   * para las campañas ABIERTAS (F9-5-2). Aviso derivado consolidado (Q1) o `null` si
   * no hay pendientes / no es redactora. Solo la profe (admin y familia: `null`).
   */
  campanaPendientes: CampanaPendientesAviso | null
  /**
   * Admin: matrículas en estado `'lista'` de su centro — altas que el tutor ya
   * finalizó y esperan la validación del director (cola de validación). El count se
   * calcula en el dashboard admin (la RLS `matriculas_admin_all` acota al centro) y
   * se inyecta aquí; para profe/familia es 0.
   */
  altasPendientesValidar: number
}
