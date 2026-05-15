'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/client'

/**
 * Hook compartido por las vistas profe y familia: se suscribe a las 5 tablas
 * de agenda y refresca la página vía `router.refresh()` al recibir cualquier
 * cambio. Opcionalmente invoca un callback (`onChange`) para que el cliente
 * bumpee algún state local (p. ej. recargar el panel expandido). RLS se
 * aplica también a las notificaciones Realtime (Supabase las descarta antes
 * de entregárselas a un cliente sin permisos), así que el filtro client-side
 * `agendaIds` o `ninoId` es cosmético: la seguridad real la enforza el motor
 * de RLS sobre `SELECT`. Ver ADR-0007 y la sección "Realtime" de
 * docs/specs/daily-agenda.md.
 *
 * `agendaIds` se usa para filtrar las notificaciones de las 4 tablas hijo y
 * `ninoIds` para la cabecera (`agendas_diarias`). Si la lista está vacía o el
 * canal no aplica, no se establece el filter (la RLS sigue cubriendo).
 */
interface UseAgendaRealtimeOptions {
  channel: string
  ninoIds?: string[]
  agendaIds?: string[]
  enabled?: boolean
  onChange?: () => void
}

export function useAgendaRealtime({
  channel,
  ninoIds,
  agendaIds,
  enabled = true,
  onChange,
}: UseAgendaRealtimeOptions): void {
  const router = useRouter()
  // join estable de ids para usar en el array de deps sin advertencias de
  // lint por expresiones complejas; reactivamos cuando cambia la lista.
  const ninosKey = ninoIds?.join(',') ?? ''
  const agendasKey = agendaIds?.join(',') ?? ''

  useEffect(() => {
    if (!enabled) return
    const supabase = createClient()
    const ch = supabase.channel(channel)
    const handler = (_payload: RealtimePostgresChangesPayload<Record<string, unknown>>): void => {
      router.refresh()
      onChange?.()
    }

    // Cabecera: filtrada por nino_id si tenemos lista; si no, todo lo que RLS permita.
    if (ninoIds && ninoIds.length > 0) {
      const filter = `nino_id=in.(${ninoIds.join(',')})`
      ch.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agendas_diarias', filter },
        handler
      )
    } else {
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'agendas_diarias' }, handler)
    }

    // Hijos: si hay agendaIds, filtramos. Si no, RLS hace el trabajo.
    const tablasHijo = ['comidas', 'biberones', 'suenos', 'deposiciones'] as const
    for (const t of tablasHijo) {
      if (agendaIds && agendaIds.length > 0) {
        ch.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: t,
            filter: `agenda_id=in.(${agendaIds.join(',')})`,
          },
          handler
        )
      } else {
        ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, handler)
      }
    }

    ch.subscribe()

    return () => {
      supabase.removeChannel(ch)
    }
    // Re-suscribir si cambian las listas de filtros (vía sus claves estables).
    // ninoIds / agendaIds se leen vía closure desde las claves *Key.
  }, [channel, ninosKey, agendasKey, enabled, onChange, router, ninoIds, agendaIds])
}
