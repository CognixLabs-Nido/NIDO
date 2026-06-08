import 'server-only'

import { createClient } from '@/lib/supabase/server'

import type { NovedadTipo } from '../types'
import { cutoffNovedades, getVistoAt } from './helpers'

/**
 * Novedad cruda (sin href de rol): la comparten el feed (`getNovedades`, que añade
 * los hrefs) y el contador del badge (`contarNovedadesNoLeidas`, que cuenta `nuevo`),
 * para que **lista y badge cuadren exactamente**.
 */
export interface RawNovedad {
  /** id del evento o de la instancia de autorización (para construir el href). */
  refId: string
  tipo: NovedadTipo
  titulo: string
  subtitulo?: string
  fecha: string
  nuevo: boolean
  pendienteConfirmacion?: boolean
}

/**
 * Recolecta las novedades del ámbito del usuario (RLS por tabla), **ignorando sus
 * propias acciones** (no autonotificar, decisión de producto): eventos que creó él,
 * instancias que creó o que **ya firmó**, y administraciones que dio él mismo. La
 * RLS de cada tabla ya filtra el ámbito (profe→aula, admin→centro, familia→hijos).
 */
export async function recolectarNovedades(): Promise<RawNovedad[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const cutoff = cutoffNovedades()
  const visto = await getVistoAt()
  const esNuevo = (ts: string) => (visto ? ts > visto : true)

  const [eventos, instancias, admins, revocaciones] = await Promise.all([
    supabase
      .from('eventos')
      .select('id, tipo, titulo, created_at')
      .neq('creado_por', user.id)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('autorizaciones')
      .select('id, tipo, titulo, created_at')
      .eq('es_plantilla', false)
      .neq('estado', 'anulada')
      .neq('creado_por', user.id)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('administraciones_medicacion')
      .select('id, autorizacion_id, medicamento, confirmado_por, created_at')
      .neq('administrado_por', user.id)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(40),
    // Revocaciones de firma (recogida/medicación) = ALERTA de seguridad: cambió
    // quién recoge / se paró una medicina. La RLS de firmas la deja ver a admin +
    // profes del aula del niño (y co-tutores). Se excluye al propio revocante.
    supabase
      .from('firmas_autorizacion')
      .select('autorizacion_id, created_at, autorizaciones(titulo, tipo)')
      .eq('decision', 'revocado')
      .neq('firmante_id', user.id)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(40),
  ])

  // Instancias que el usuario YA firmó (su propia acción) → fuera del feed.
  const instanciaIds = (instancias.data ?? []).map((a) => a.id)
  const firmadasPropias = new Set<string>()
  if (instanciaIds.length) {
    const { data: firmas } = await supabase
      .from('firmas_autorizacion')
      .select('autorizacion_id')
      .eq('firmante_id', user.id)
      .eq('decision', 'firmado')
      .in('autorizacion_id', instanciaIds)
    for (const f of firmas ?? []) firmadasPropias.add(f.autorizacion_id)
  }

  const items: RawNovedad[] = []

  for (const e of eventos.data ?? []) {
    items.push({
      refId: e.id,
      tipo: 'evento',
      titulo: e.titulo,
      subtitulo: e.tipo,
      fecha: e.created_at,
      nuevo: esNuevo(e.created_at),
    })
  }

  for (const a of instancias.data ?? []) {
    if (firmadasPropias.has(a.id)) continue
    const tipo: NovedadTipo =
      a.tipo === 'recogida' ? 'recogida' : a.tipo === 'medicacion' ? 'medicacion' : 'autorizacion'
    items.push({
      refId: a.id,
      tipo,
      titulo: a.titulo,
      subtitulo: a.tipo,
      fecha: a.created_at,
      nuevo: esNuevo(a.created_at),
    })
  }

  for (const m of admins.data ?? []) {
    items.push({
      refId: m.autorizacion_id,
      tipo: 'administracion',
      titulo: m.medicamento,
      fecha: m.created_at,
      nuevo: esNuevo(m.created_at),
      pendienteConfirmacion: m.confirmado_por === null,
    })
  }

  // Revocaciones: una alerta por instancia (la más reciente; las filas vienen
  // ordenadas por created_at desc, así que el primer visto por autorizacion gana).
  const vistaRevocacion = new Set<string>()
  for (const r of revocaciones.data ?? []) {
    if (vistaRevocacion.has(r.autorizacion_id)) continue
    vistaRevocacion.add(r.autorizacion_id)
    const aut = (Array.isArray(r.autorizaciones) ? r.autorizaciones[0] : r.autorizaciones) as {
      titulo: string
      tipo: string
    } | null
    items.push({
      refId: r.autorizacion_id,
      tipo: 'revocacion',
      titulo: aut?.titulo ?? '',
      subtitulo: aut?.tipo,
      fecha: r.created_at,
      nuevo: esNuevo(r.created_at),
    })
  }

  items.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))
  return items.slice(0, 50)
}
