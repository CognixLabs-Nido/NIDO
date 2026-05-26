import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMessagingRealtime } from '../use-messaging-realtime'

/**
 * Test de regresión del hotfix `fix/messaging-badge-realtime-order`.
 *
 * Bug original (post-merge #16): Supabase Realtime lanza
 *   "cannot add `postgres_changes` callbacks for realtime:<name>
 *    after `subscribe()`"
 * cuando se hace `.on(...)` tras `.subscribe()` sobre el mismo channel.
 *
 * Causa: el hook usaba un nombre de channel LITERAL (`messaging-badge-global`)
 * sin sufijo único. supabase-js reutiliza channels por nombre; cuando una
 * segunda instancia del hook se monta (p.ej. al navegar entre layouts),
 * obtiene el mismo channel que la primera ya hizo subscribe, y los `.on(...)`
 * fallan.
 *
 * Fix:
 *  1. Patrón chained `supabase.channel(...).on(...).on(...).subscribe()`.
 *  2. Sufijo único por instancia via `useId()`.
 *
 * Estos tests usan un mock de `createClient` que registra el orden de
 * llamadas a `channel`, `on` y `subscribe` y verifican el invariante.
 */

// Tracker de llamadas (compartido entre los mocks de @/lib/supabase/client
// y los asserts del test).
type CallLog = { method: string; args: unknown[] }
const calls: CallLog[] = []

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined }),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const channelApi: Record<string, (...args: unknown[]) => unknown> = {
      on: (...args: unknown[]) => {
        calls.push({ method: 'on', args })
        return channelApi
      },
      subscribe: (...args: unknown[]) => {
        calls.push({ method: 'subscribe', args })
        return channelApi
      },
      unsubscribe: () => Promise.resolve(),
    }
    return {
      channel: (name: string) => {
        calls.push({ method: 'channel', args: [name] })
        return channelApi
      },
      removeChannel: (_ch: unknown) => {
        calls.push({ method: 'removeChannel', args: [] })
      },
    }
  },
}))

function Harness(props: Parameters<typeof useMessagingRealtime>[0]) {
  useMessagingRealtime(props)
  return null
}

describe('useMessagingRealtime — orden de llamadas Realtime', () => {
  beforeEach(() => {
    calls.length = 0
  })

  it('registra TODOS los listeners .on(...) ANTES de .subscribe()', () => {
    render(<Harness channel="messaging-badge-global" />)

    const ons = calls
      .map((c, i) => ({ ...c, i }))
      .filter((c) => c.method === 'on')
      .map((c) => c.i)
    const subscribeIndex = calls.findIndex((c) => c.method === 'subscribe')

    // Hay al menos 2 listeners (mensajes + anuncios) y un subscribe.
    expect(ons.length).toBeGreaterThanOrEqual(2)
    expect(subscribeIndex).toBeGreaterThan(-1)
    // El subscribe debe ser POSTERIOR a todos los .on().
    expect(Math.max(...ons)).toBeLessThan(subscribeIndex)
  })

  it('subscribe se llama una sola vez por montaje', () => {
    render(<Harness channel="conv-1234" />)
    const subscribes = calls.filter((c) => c.method === 'subscribe')
    expect(subscribes.length).toBe(1)
  })

  it('el nombre del channel incluye el sufijo único de useId (no colisiona entre instancias)', () => {
    render(<Harness channel="messaging-badge-global" />)
    render(<Harness channel="messaging-badge-global" />)

    const channelCalls = calls.filter((c) => c.method === 'channel')
    expect(channelCalls.length).toBe(2)
    const [n1, n2] = channelCalls.map((c) => c.args[0] as string)
    // Ambos arrancan con la base "messaging-badge-global:" + un id único.
    expect(n1.startsWith('messaging-badge-global:')).toBe(true)
    expect(n2.startsWith('messaging-badge-global:')).toBe(true)
    expect(n1).not.toBe(n2)
  })

  it('con conversacionId, el filter del listener de mensajes apunta a esa conversación', () => {
    render(<Harness channel="messages-conv" conversacionId="abc-123" />)
    const onMensajes = calls.find(
      (c) =>
        c.method === 'on' &&
        typeof c.args[1] === 'object' &&
        c.args[1] !== null &&
        (c.args[1] as Record<string, unknown>).table === 'mensajes'
    )
    expect(onMensajes).toBeDefined()
    const cfg = onMensajes!.args[1] as Record<string, unknown>
    expect(cfg.filter).toBe('conversacion_id=eq.abc-123')
  })

  it('enabled=false NO crea channel ni llama subscribe', () => {
    render(<Harness channel="messaging-badge-global" enabled={false} />)
    expect(calls.find((c) => c.method === 'channel')).toBeUndefined()
    expect(calls.find((c) => c.method === 'subscribe')).toBeUndefined()
  })

  it('al desmontar, removeChannel limpia la suscripción', () => {
    const { unmount } = render(<Harness channel="messaging-badge-global" />)
    expect(calls.find((c) => c.method === 'subscribe')).toBeDefined()
    unmount()
    expect(calls.find((c) => c.method === 'removeChannel')).toBeDefined()
  })
})
