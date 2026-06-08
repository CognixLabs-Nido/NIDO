import 'server-only'

import { createClient } from '@/lib/supabase/server'

import { cutoffNovedades, esStaff, getVistoAt, segmentoRol, type RolNotif } from '../lib/helpers'
import type { NovedadItem, NovedadTipo } from '../types'

/**
 * Feed DERIVADO de novedades por rol (C1, sin migración): unión de filas recientes
 * de `eventos` (excursiones/calendario), `autorizaciones` (instancias de recogida =
 * personas autorizadas, medicación, y otras enviadas) y `administraciones_medicacion`.
 * La RLS de cada tabla filtra el ámbito (profe→su aula, admin→centro, familia→hijos);
 * aquí solo normalizamos, marcamos `nuevo` (created_at posterior al marcador `visto_at`)
 * y ordenamos por fecha. Los hrefs apuntan a la ruta de autorizaciones del rol.
 */
export async function getNovedades(rol: RolNotif, locale: string): Promise<NovedadItem[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const cutoff = cutoffNovedades()
  const visto = await getVistoAt()
  const esNuevo = (ts: string) => (visto ? ts > visto : true)

  const autBase = esStaff(rol)
    ? `/${locale}/admin/autorizaciones`
    : `/${locale}/family/autorizaciones`
  const calHref = `/${locale}/${segmentoRol(rol)}/calendario`

  const [eventos, instancias, admins] = await Promise.all([
    supabase
      .from('eventos')
      .select('id, tipo, titulo, created_at')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('autorizaciones')
      .select('id, tipo, titulo, created_at')
      .eq('es_plantilla', false)
      .neq('estado', 'anulada')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('administraciones_medicacion')
      .select('id, autorizacion_id, medicamento, administrado_por, confirmado_por, created_at')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(40),
  ])

  const items: NovedadItem[] = []

  for (const e of eventos.data ?? []) {
    items.push({
      key: `ev-${e.id}`,
      tipo: 'evento',
      titulo: e.titulo,
      subtitulo: e.tipo,
      fecha: e.created_at,
      href: calHref,
      nuevo: esNuevo(e.created_at),
    })
  }

  for (const a of instancias.data ?? []) {
    const tipo: NovedadTipo =
      a.tipo === 'recogida' ? 'recogida' : a.tipo === 'medicacion' ? 'medicacion' : 'autorizacion'
    items.push({
      key: `au-${a.id}`,
      tipo,
      titulo: a.titulo,
      subtitulo: a.tipo,
      fecha: a.created_at,
      href: `${autBase}/${a.id}`,
      nuevo: esNuevo(a.created_at),
    })
  }

  for (const m of admins.data ?? []) {
    items.push({
      key: `ad-${m.id}`,
      tipo: 'administracion',
      titulo: m.medicamento,
      fecha: m.created_at,
      href: `${autBase}/${m.autorizacion_id}`,
      nuevo: esNuevo(m.created_at),
      // Pendiente de la confirmación del usuario actual (no la suya propia).
      pendienteConfirmacion: m.confirmado_por === null && m.administrado_por !== user.id,
    })
  }

  items.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))
  return items.slice(0, 50)
}
