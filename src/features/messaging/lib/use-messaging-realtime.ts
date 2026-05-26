'use client'

import { useEffect, useId } from 'react'
import { useRouter } from 'next/navigation'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/client'

/**
 * Hook compartido por la lista (/messages), las vistas de detalle y el
 * badge global: se suscribe a `mensajes` y `anuncios` y refresca la
 * página vía `router.refresh()` al recibir cualquier cambio.
 *
 * Las RLS de SELECT se aplican también a las notificaciones Realtime —
 * el cliente solo recibe eventos sobre filas que su rol puede leer
 * (ADR-0007, sección "Realtime y RLS" de docs/architecture/rls-policies.md).
 *
 * Si el caller pasa un callback `onChange`, se invoca después de
 * `router.refresh()` para que pueda recalcular estado local (p.ej.
 * el contador del badge).
 *
 * ## Orden de llamadas a Supabase Realtime
 *
 * Supabase Realtime exige registrar TODOS los listeners `.on(...)`
 * ANTES de `.subscribe()`. Llamar `.on(...)` tras subscribe lanza:
 *
 *   Uncaught Error: cannot add `postgres_changes` callbacks for
 *   realtime:<name> after `subscribe()`.
 *
 * Aquí se usa el patrón "chained": `supabase.channel(name).on(...).on(...).subscribe()`.
 * El encadenamiento garantiza que no haya ningún render intermedio o
 * efecto que pueda colar un `.subscribe()` antes de tiempo.
 *
 * ## Nombres de channel y unicidad por instancia
 *
 * Supabase-js mantiene los channels en un Map por NOMBRE en el cliente
 * browser. Si dos instancias del hook usan el mismo `channel` literal
 * (p.ej. el badge global montado en el layout y luego remontado al
 * navegar entre layouts), la segunda instancia obtiene el MISMO channel
 * que la primera ya hizo subscribe — y `.on(...)` falla con el error de
 * arriba.
 *
 * Solución: combinar el `channel` semántico (útil para debug) con un
 * sufijo `useId()` único por instancia. React garantiza que `useId` es
 * estable entre renders de la misma instancia, así que el cleanup
 * removeChannel y la re-suscripción tras cambio de deps funcionan bien.
 */
interface UseMessagingRealtimeOptions {
  channel: string
  conversacionId?: string
  /**
   * Si se pasa, el hook abre un listener adicional sobre `lectura_anuncio`
   * filtrado por este `anuncio_id`. Pensado para la vista del autor del
   * anuncio (`AnuncioView`): cuando un destinatario marca el anuncio como
   * leído, la fila INSERT en `lectura_anuncio` dispara `router.refresh()` y
   * el contador "X de Y" se actualiza en vivo. La policy de SELECT
   * `lectura_anuncio_select_autor` (migración `phase5_lectura_anuncio_autor_select_realtime`)
   * garantiza que el autor reciba el evento; el resto de usuarios no porque
   * RLS también filtra las notificaciones Realtime.
   */
  anuncioIdParaLecturas?: string
  enabled?: boolean
  onChange?: (table: 'mensajes' | 'anuncios' | 'lectura_conversacion' | 'lectura_anuncio') => void
}

export function useMessagingRealtime({
  channel,
  conversacionId,
  anuncioIdParaLecturas,
  enabled = true,
  onChange,
}: UseMessagingRealtimeOptions): void {
  const router = useRouter()
  const instanceId = useId()
  const channelName = `${channel}:${instanceId}`

  useEffect(() => {
    if (!enabled) return
    const supabase = createClient()

    const handle = (
      table: 'mensajes' | 'anuncios' | 'lectura_conversacion' | 'lectura_anuncio'
    ) => {
      return (_payload: RealtimePostgresChangesPayload<Record<string, unknown>>): void => {
        router.refresh()
        onChange?.(table)
      }
    }

    // Patrón chained: TODOS los .on() encadenados ANTES del .subscribe().
    // Cualquier .on() tras subscribe lanza error en supabase-js.
    const mensajesFilter = conversacionId
      ? {
          event: '*' as const,
          schema: 'public',
          table: 'mensajes',
          filter: `conversacion_id=eq.${conversacionId}`,
        }
      : { event: '*' as const, schema: 'public', table: 'mensajes' }

    let chain = supabase
      .channel(channelName)
      .on('postgres_changes', mensajesFilter, handle('mensajes'))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'anuncios' },
        handle('anuncios')
      )

    if (anuncioIdParaLecturas) {
      chain = chain.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'lectura_anuncio',
          filter: `anuncio_id=eq.${anuncioIdParaLecturas}`,
        },
        handle('lectura_anuncio')
      )
    }

    const ch = chain.subscribe()

    return () => {
      supabase.removeChannel(ch)
    }
  }, [channelName, conversacionId, anuncioIdParaLecturas, enabled, onChange, router])
}
