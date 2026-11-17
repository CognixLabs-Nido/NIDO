import 'server-only'

import { aplicarMatriculaActiva } from '@/features/matriculas/lib/matricula-activa'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { EventoCalendario, EventoDetalle, RosterConfirmacion } from '../types'

const COLS =
  'id, ambito, tipo, titulo, descripcion, lugar, fecha, fecha_fin, hora_inicio, hora_fin, requiere_confirmacion, estado, aula_id, nino_id, centro_id, creado_por'

/**
 * Detalle de un evento + su roster de confirmaciones. **Filtrado por RLS según
 * el rol**: el staff ve todos los niños de la audiencia; la familia ve solo a
 * sus hijos (las queries a `ninos`/`matriculas`/`confirmaciones_evento` heredan
 * la RLS del usuario). `estado='pendiente'` = sin fila de confirmación.
 *
 * `puede_confirmar`: quien mira es tutor legal del niño. Solo confirman los padres (Jose, 2026-11-13): al
 * autorizado la base no le deja leer ni escribir la confirmación (`20270125130000`), así que su
 * «pendiente» no sería un dato, y la vista de familia no le enseña esa fila. Si la lectura de sus
 * vínculos falla, nadie confirma: nunca un botón que la base va a rechazar como si no pasara nada.
 *
 * Devuelve `null` si el evento no existe o el usuario no es audiencia (RLS).
 */
export async function getEventoDetalle(eventoId: string): Promise<EventoDetalle | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: ev, error } = await supabase
    .from('eventos')
    .select(COLS)
    .eq('id', eventoId)
    .maybeSingle()

  if (error) {
    logger.warn('getEventoDetalle: eventos.select', error.message)
    return null
  }
  if (!ev) return null

  // Niños de la audiencia visibles para el usuario.
  let ninoIds: string[] = []
  if (ev.ambito === 'nino' && ev.nino_id) {
    ninoIds = [ev.nino_id]
  } else if (ev.ambito === 'aula' && ev.aula_id) {
    const { data: mats } = await aplicarMatriculaActiva(
      supabase.from('matriculas').select('nino_id').eq('aula_id', ev.aula_id)
    )
    ninoIds = (mats ?? []).map((m) => m.nino_id)
  } else if (ev.ambito === 'centro') {
    const { data: ns } = await supabase
      .from('ninos')
      .select('id')
      .eq('centro_id', ev.centro_id)
      .is('deleted_at', null)
    ninoIds = (ns ?? []).map((n) => n.id)
  }

  let roster: RosterConfirmacion[] = []
  if (ninoIds.length > 0) {
    const [{ data: ninos }, { data: confs }, legales] = await Promise.all([
      supabase
        .from('ninos')
        .select('id, nombre, apellidos')
        .in('id', ninoIds)
        .is('deleted_at', null),
      supabase
        .from('confirmaciones_evento')
        .select('nino_id, estado, comentario, confirmado_at')
        .eq('evento_id', eventoId),
      user
        ? supabase
            .from('vinculos_familiares')
            .select('nino_id')
            .eq('usuario_id', user.id)
            .in('nino_id', ninoIds)
            .in('tipo_vinculo', ['tutor_legal_principal', 'tutor_legal_secundario'])
            .is('deleted_at', null)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (legales.error) {
      logger.warn('getEventoDetalle: vinculos_familiares.select', legales.error.message)
    }
    const deLosQueEsTutorLegal = new Set(
      legales.error ? [] : (legales.data ?? []).map((v) => v.nino_id)
    )

    const confMap = new Map((confs ?? []).map((c) => [c.nino_id, c]))
    roster = (ninos ?? [])
      .map((n) => {
        const c = confMap.get(n.id)
        return {
          nino_id: n.id,
          nino_nombre: `${n.nombre} ${n.apellidos}`.trim(),
          estado: c?.estado ?? 'pendiente',
          comentario: c?.comentario ?? null,
          confirmado_at: c?.confirmado_at ?? null,
          puede_confirmar: deLosQueEsTutorLegal.has(n.id),
        } satisfies RosterConfirmacion
      })
      .sort((a, b) => a.nino_nombre.localeCompare(b.nino_nombre))
  }

  const evento: EventoCalendario = {
    id: ev.id,
    ambito: ev.ambito,
    tipo: ev.tipo,
    titulo: ev.titulo,
    descripcion: ev.descripcion,
    lugar: ev.lugar,
    fecha: ev.fecha,
    fecha_fin: ev.fecha_fin,
    hora_inicio: ev.hora_inicio,
    hora_fin: ev.hora_fin,
    requiere_confirmacion: ev.requiere_confirmacion,
    estado: ev.estado,
    aula_id: ev.aula_id,
    nino_id: ev.nino_id,
  }
  return { evento, roster, es_autor: !!user && ev.creado_por === user.id }
}
