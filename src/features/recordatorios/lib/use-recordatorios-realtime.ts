'use client'

import { useEffect, useId } from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/client'

/**
 * Suscripción Realtime a `recordatorios`. Notifica al caller vía `onChange`
 * ante cualquier INSERT/UPDATE/DELETE que el usuario pueda leer (la RLS de
 * SELECT filtra también las notificaciones Realtime). El caller decide qué
 * hacer — típicamente `router.refresh()`.
 *
 * Mismo patrón que `use-messaging-realtime`: canal con sufijo `useId()` único
 * por instancia (evita colisión en el Map de channels de supabase-js) y todos
 * los `.on()` encadenados antes de `.subscribe()`. `onChange` debe ir
 * memoizado con `useCallback` por el caller.
 */
interface UseRecordatoriosRealtimeOptions {
  channel: string
  enabled?: boolean
  onChange?: () => void
}

export function useRecordatoriosRealtime({
  channel,
  enabled = true,
  onChange,
}: UseRecordatoriosRealtimeOptions): void {
  const instanceId = useId()
  const channelName = `${channel}:${instanceId}`

  useEffect(() => {
    if (!enabled) return
    const supabase = createClient()

    const ch = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'recordatorios' },
        (_payload: RealtimePostgresChangesPayload<Record<string, unknown>>): void => {
          onChange?.()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(ch)
    }
  }, [channelName, enabled, onChange])
}
