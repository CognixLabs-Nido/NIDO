import type { Database } from '@/types/database'

/**
 * Alta unificada · U-4 (D4) — mapeo ESTADO → BADGE + ACCIONES de la lista de admisiones.
 *
 * Problema que cierra: la lista solo ofrecía acciones a los prospectos `en_espera`. Un
 * prospecto YA promovido (niño creado, alta a medias) se quedaba MUDO: sin botones, sin forma
 * de reanudar el wizard y sin decir en qué punto estaba. Prospectos atascados.
 *
 * Decisión D4 = B: **sin estado nuevo**. El estado sigue siendo el del prospecto
 * (`en_espera` | `invitado`; `descartado` ni se lista) combinado con el estado REAL de la
 * matrícula del niño enlazado, que ya se calcula. De ese par salen badge y acciones.
 *
 * INVARIANTE que esta pieza garantiza: **`acciones` nunca es vacío**. Cualquier combinación
 * —incluida la degradada "promovido pero sin enlace"— produce al menos una acción útil. Está
 * cubierto por un test exhaustivo sobre el producto cartesiano de entradas.
 */

/** Estado de la matrícula ACTIVA del niño (`fecha_baja IS NULL`), o null si no hay. */
export type EstadoMatricula = Database['public']['Enums']['matricula_estado']

export type AccionProspecto =
  /** Promover mandando invitación por email al tutor. */
  | 'invitar'
  /** Promover en nombre del tutor, sin email (Dirección). */
  | 'completar'
  /** Abrir el wizard `/alta/[ninoId]` donde se quedó (en modo Dirección si lo pulsa admin). */
  | 'reanudar'
  /** El alta ya está validada: admisiones no tiene nada que hacer → ficha del alumno. */
  | 'ver_ficha'

export type BadgeProspecto =
  | 'en_espera'
  | 'invitado'
  | 'alta_en_curso'
  | 'pendiente_validar'
  | 'matriculado'
  | 'baja'

export interface SenalesProspecto {
  estado: Database['public']['Enums']['estado_lista_espera']
  /** `lista_espera.nino_id` (U-4). NULL = sin promover, o promoción vieja no reconstruible. */
  ninoId: string | null
  /** Estado de la matrícula activa de ese niño; null si no hay matrícula activa. */
  estadoMatricula: EstadoMatricula | null
}

export interface ResolucionProspecto {
  badge: BadgeProspecto
  /** Siempre ≥ 1 elemento (invariante de la pieza). */
  acciones: AccionProspecto[]
}

const SIN_PROMOVER: AccionProspecto[] = ['invitar', 'completar']

/**
 * Reglas, en orden de decisión:
 *
 * 1. **Sin niño enlazado** → sin promover a efectos prácticos: Invitar / Completar. Cubre
 *    tanto el `en_espera` normal como el caso degradado "está `invitado` pero perdimos el
 *    enlace" (promoción anterior a U-4 que el backfill no pudo reconstruir, o niño borrado
 *    con `ON DELETE SET NULL`). Ese caso ANTES era el mudo; ahora vuelve a ofrecer la
 *    promoción, que es exactamente lo que hay que hacer con él.
 * 2. **Con niño y matrícula `pendiente`** → el alta está a medias: REANUDAR el wizard.
 * 3. **Con niño y matrícula `lista`** → el tutor ya cerró su parte y espera validación de
 *    Dirección. Se sigue ofreciendo reanudar: el wizard sirve ahí la pantalla "completado,
 *    pendiente de validación" con su enlace de edición, así que es una acción útil, no un
 *    callejón.
 * 4. **Con niño y matrícula `activa`** → alta validada. Admisiones ya no actúa sobre ella:
 *    la acción útil es ver la ficha del alumno. (Jubilar la fila de la lista es U-5, no aquí.)
 * 5. **Con niño y matrícula `baja` o sin matrícula activa** → causó baja o nunca llegó a
 *    matricularse. No se reabre el alta desde admisiones; se ofrece la ficha para mirar.
 *
 * `descartado` no llega hasta aquí (`getListaEspera` lo excluye), pero se resuelve igual que
 * el resto por el enlace: si tuviera niño, ficha; si no, promoverlo de nuevo.
 */
export function resolverProspecto(s: SenalesProspecto): ResolucionProspecto {
  if (!s.ninoId) {
    return {
      badge: s.estado === 'invitado' ? 'invitado' : 'en_espera',
      acciones: SIN_PROMOVER,
    }
  }

  switch (s.estadoMatricula) {
    case 'pendiente':
      return { badge: 'alta_en_curso', acciones: ['reanudar'] }
    case 'lista':
      return { badge: 'pendiente_validar', acciones: ['reanudar', 'ver_ficha'] }
    case 'activa':
      return { badge: 'matriculado', acciones: ['ver_ficha'] }
    case 'baja':
      return { badge: 'baja', acciones: ['ver_ficha'] }
    // Niño enlazado pero sin matrícula activa (borrada, o aún no creada): la ficha existe y
    // es lo único razonable que ofrecer. Nunca se devuelve la lista vacía.
    default:
      return { badge: 'invitado', acciones: ['ver_ficha'] }
  }
}
