import type { RecordatorioDestinatarioInput } from '../schemas/recordatorios'
import { VENTANA_ANULACION_MS } from './constants'

type RolUsuario = 'admin' | 'profe' | 'tutor_legal' | 'autorizado'

/**
 * Destinos que un rol puede CREAR. Hotfix #44: el MVP de recordatorios es solo
 * para admin/profe; tutor_legal/autorizado no usan el módulo (sidebar oculto +
 * guard en la ruta), así que devuelven lista vacía.
 *
 *  - admin/profe → `familia` (centro→familia) y `personal` (nota propia).
 *    Se omite `direccion` por decisión de producto (admin ES la dirección;
 *    profe no escala a admin por este canal). NO se ofrece `equipo`: su RLS de
 *    INSERT exige `es_tutor_de(nino)` — habilitarlo para admin/profe es un
 *    cambio de modelo diferido a F6-C (granularidad fina de destinatarios).
 *  - tutor_legal/autorizado → `[]`: fuera del MVP de recordatorios.
 */
export function destinosParaRol(rol: RolUsuario): RecordatorioDestinatarioInput[] {
  if (rol === 'admin' || rol === 'profe') {
    return ['familia', 'personal']
  }
  return []
}

/** Solo familia/equipo van asociados a un niño (CHECK estructural de F6-A). */
export function requiereNino(destino: RecordatorioDestinatarioInput): boolean {
  return destino === 'familia' || destino === 'equipo'
}

/**
 * ¿Puede el usuario `userId` anular este recordatorio AHORA? Solo el emisor,
 * dentro de la ventana de 5 min, y si no está ya anulado/completado. Misma
 * regla que enforza `anularRecordatorioCore`; aquí decide si el botón se
 * muestra. `nowMs` inyectable para tests.
 */
export function puedeAnular(
  rec: { creado_por: string; created_at: string; erroneo: boolean; completado_en: string | null },
  userId: string,
  nowMs: number = Date.now()
): boolean {
  if (rec.creado_por !== userId) return false
  if (rec.erroneo || rec.completado_en) return false
  return nowMs - new Date(rec.created_at).getTime() <= VENTANA_ANULACION_MS
}

/**
 * Convierte el valor de un `<input type="datetime-local">` (string local
 * 'YYYY-MM-DDTHH:mm', sin zona) a ISO con offset para el schema. En el piloto
 * ANAIA el navegador está en huso Europe/Madrid, así que `new Date(local)`
 * interpreta el valor como hora de Madrid y `toISOString()` da el UTC correcto.
 * Devuelve null si está vacío o es inválido.
 */
export function datetimeLocalAIso(value: string | null | undefined): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}
