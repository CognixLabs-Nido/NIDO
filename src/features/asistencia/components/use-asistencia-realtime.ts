'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/client'

/**
 * Suscripción Realtime a `asistencias` y `ausencias`. La auto-publicación de
 * estas tablas se hace en la migración (ALTER PUBLICATION ... ADD TABLE).
 * RLS filtra qué eventos llegan a cada cliente; el filtro `nino_id=in.(...)`
 * es cosmético (mismo razonamiento que en useAgendaRealtime).
 */
interface Options {
  channel: string
  ninoIds: string[]
  enabled?: boolean
  onChange?: () => void
}

export function useAsistenciaRealtime({
  channel,
  ninoIds,
  enabled = true,
  onChange,
}: Options): void {
  const router = useRouter()
  const ninosKey = ninoIds.join(',')

  useEffect(() => {
    if (!enabled) return
    const supabase = createClient()
    const ch = supabase.channel(channel)
    const handler = (_payload: RealtimePostgresChangesPayload<Record<string, unknown>>): void => {
      router.refresh()
      onChange?.()
    }

    const filter = ninoIds.length > 0 ? `nino_id=in.(${ninoIds.join(',')})` : undefined
    if (filter) {
      ch.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'asistencias', filter },
        handler
      )
      ch.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ausencias', filter },
        handler
      )
    } else {
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'asistencias' }, handler)
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'ausencias' }, handler)
    }

    ch.subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [channel, ninosKey, enabled, onChange, router, ninoIds])
}
