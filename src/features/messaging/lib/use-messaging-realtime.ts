'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/client'

/**
 * Hook compartido por la lista (/messages) y la cabecera/badge global:
 * se suscribe a `mensajes` y `anuncios` y refresca la página vía
 * `router.refresh()` al recibir cualquier cambio. Las RLS de SELECT
 * se aplican también a las notificaciones Realtime — el cliente solo
 * recibe eventos sobre filas que su rol puede leer (ADR-0007, sección
 * "Realtime y RLS" de docs/architecture/rls-policies.md).
 *
 * Si el caller pasa un callback `onChange`, se invoca después de
 * `router.refresh()` para que pueda recalcular estado local (p.ej.
 * el contador del badge).
 */
interface UseMessagingRealtimeOptions {
  channel: string
  conversacionId?: string
  enabled?: boolean
  onChange?: (table: 'mensajes' | 'anuncios' | 'lectura_conversacion' | 'lectura_anuncio') => void
}

export function useMessagingRealtime({
  channel,
  conversacionId,
  enabled = true,
  onChange,
}: UseMessagingRealtimeOptions): void {
  const router = useRouter()

  useEffect(() => {
    if (!enabled) return
    const supabase = createClient()
    const ch = supabase.channel(channel)

    const handle = (
      table: 'mensajes' | 'anuncios' | 'lectura_conversacion' | 'lectura_anuncio'
    ) => {
      return (_payload: RealtimePostgresChangesPayload<Record<string, unknown>>): void => {
        router.refresh()
        onChange?.(table)
      }
    }

    if (conversacionId) {
      ch.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mensajes',
          filter: `conversacion_id=eq.${conversacionId}`,
        },
        handle('mensajes')
      )
    } else {
      ch.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mensajes' },
        handle('mensajes')
      )
    }

    ch.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'anuncios' },
      handle('anuncios')
    )

    ch.subscribe()

    return () => {
      supabase.removeChannel(ch)
    }
  }, [channel, conversacionId, enabled, onChange, router])
}
