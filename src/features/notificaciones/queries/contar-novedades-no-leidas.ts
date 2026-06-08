import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { cutoffNovedades, getVistoAt } from '../lib/helpers'

/**
 * Cuenta novedades NO LEÍDAS para el badge del item «Notificaciones» del sidebar:
 * filas creadas después del marcador `visto_at` (o dentro de la ventana si nunca lo
 * abrió) en eventos + instancias de autorización + administraciones. La RLS de cada
 * tabla filtra el ámbito del rol, así que no hace falta pasarlo. Devuelve 0 ante
 * cualquier fallo (el badge no debe romper el layout). Sin Realtime: se recalcula
 * en server-render al navegar (patrón AgendaBadge).
 */
export async function contarNovedadesNoLeidas(): Promise<number> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return 0

  const since = (await getVistoAt()) ?? cutoffNovedades()
  try {
    const [ev, au, ad] = await Promise.all([
      supabase.from('eventos').select('id', { count: 'exact', head: true }).gt('created_at', since),
      supabase
        .from('autorizaciones')
        .select('id', { count: 'exact', head: true })
        .eq('es_plantilla', false)
        .neq('estado', 'anulada')
        .gt('created_at', since),
      supabase
        .from('administraciones_medicacion')
        .select('id', { count: 'exact', head: true })
        .gt('created_at', since),
    ])
    return (ev.count ?? 0) + (au.count ?? 0) + (ad.count ?? 0)
  } catch (e) {
    logger.warn('contarNovedadesNoLeidas', e instanceof Error ? e.message : String(e))
    return 0
  }
}
