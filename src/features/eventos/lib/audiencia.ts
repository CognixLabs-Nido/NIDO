import 'server-only'

import { expandirDestinatariosRecordatorio } from '@/features/recordatorios/lib/audiencia'
import { createServiceClient } from '@/lib/supabase/server'

import type { AmbitoEvento } from '../types'

/**
 * Audiencia push de un evento. **Cero duplicación**: mapea el ámbito del evento
 * a los destinos familia_* de F6-C y delega en `expandirDestinatariosRecordatorio`
 * (que ya resuelve niños/aula/centro y respeta `puede_recibir_mensajes`, D4).
 *
 *   nino   → familia_individual
 *   aula   → familias_aula
 *   centro → familias_centro
 *
 * Si en el futuro la audiencia de eventos divergiera de la de recordatorios, se
 * extraería el helper de bajo nivel a `features/push/lib` (nota en la spec).
 */
export async function audienciaPushEvento(
  evento: {
    ambito: AmbitoEvento
    centro_id: string
    aula_id: string | null
    nino_id: string | null
  },
  excluyendoUserId: string
): Promise<string[]> {
  const destinatario =
    evento.ambito === 'nino'
      ? 'familia_individual'
      : evento.ambito === 'aula'
        ? 'familias_aula'
        : 'familias_centro'

  return expandirDestinatariosRecordatorio(
    {
      destinatario,
      centro_id: evento.centro_id,
      nino_id: evento.ambito === 'nino' ? evento.nino_id : null,
      aula_id: evento.ambito === 'aula' ? evento.aula_id : null,
      usuario_destinatario_id: null,
    },
    excluyendoUserId
  )
}

/**
 * Tutores (con flag `puede_recibir_mensajes`) de los niños que YA habían
 * confirmado asistencia a un evento. Usado al **cancelar** (D7): no es un flip
 * silencioso — se avisa a quien contaba con ir.
 *
 * Service role (la auth ya se verificó en el server action que invoca). Distinto
 * de la audiencia general: aquí el subconjunto sale de `confirmaciones_evento`.
 */
export async function tutoresDeNinosConfirmados(
  eventoId: string,
  excluyendoUserId: string
): Promise<string[]> {
  const supabase = await createServiceClient()

  const { data: confs } = await supabase
    .from('confirmaciones_evento')
    .select('nino_id')
    .eq('evento_id', eventoId)
    .eq('estado', 'confirmado')

  const ninoIds = (confs ?? []).map((c) => c.nino_id)
  if (ninoIds.length === 0) return []

  const { data: vinculos } = await supabase
    .from('vinculos_familiares')
    .select('usuario_id, permisos')
    .in('nino_id', ninoIds)
    .is('deleted_at', null)

  const out = new Set<string>()
  for (const v of vinculos ?? []) {
    const permisos = (v.permisos as Record<string, boolean> | null) ?? {}
    if (permisos.puede_recibir_mensajes === true) out.add(v.usuario_id)
  }
  out.delete(excluyendoUserId)
  return Array.from(out)
}
