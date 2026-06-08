import 'server-only'

import { logger } from '@/shared/lib/logger'

import { recolectarNovedades } from '../lib/recolectar'

/**
 * Cuenta novedades NO LEÍDAS para el badge del item «Notificaciones» del sidebar.
 * Usa el MISMO recolector que el feed → el contador coincide con lo que se ve en
 * /notifications (mismas exclusiones de acciones propias, mismo marcador `visto_at`).
 * Devuelve 0 ante cualquier fallo (el badge no debe romper el layout). Sin Realtime:
 * se recalcula en server-render al navegar (patrón AgendaBadge).
 */
export async function contarNovedadesNoLeidas(): Promise<number> {
  try {
    const raw = await recolectarNovedades()
    return raw.filter((n) => n.nuevo).length
  } catch (e) {
    logger.warn('contarNovedadesNoLeidas', e instanceof Error ? e.message : String(e))
    return 0
  }
}
