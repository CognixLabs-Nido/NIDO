// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'

import es from '../../../../messages/es.json'

const h = vi.hoisted(() => ({
  onChange: {} as Record<string, () => void>,
  unread: vi.fn(),
  recordatorios: vi.fn(),
}))
vi.mock('@/features/messaging/lib/use-messaging-realtime', () => ({
  useMessagingRealtime: (o: { onChange: () => void }) => {
    h.onChange.mensajes = o.onChange
  },
}))
vi.mock('@/features/recordatorios/lib/use-recordatorios-realtime', () => ({
  useRecordatoriosRealtime: (o: { onChange: () => void }) => {
    h.onChange.recordatorios = o.onChange
  },
}))
vi.mock('@/features/messaging/actions/get-unread-counts', () => ({
  getUnreadCountsAction: h.unread,
}))
vi.mock('@/features/recordatorios/actions/get-pendientes-count-action', () => ({
  getRecordatoriosPendientesCountAction: h.recordatorios,
}))

import { AgendaBadge } from '@/features/agenda/components/AgendaBadge'
import { CambiosPendientesBadge } from '@/features/cambios-pendientes/components/CambiosPendientesBadge'
import { MessagingBadge } from '@/features/messaging/components/MessagingBadge'
import { RecordatoriosBadge } from '@/features/recordatorios/components/RecordatoriosBadge'

/**
 * Censo C (decisión de Jose del 2026-11-25): con el contador sin leer, el badge del menú pinta «?», nunca
 * un 0 ni el número de antes. Los cuatro badges, con la mutación por GRUPO (el `=== null` de cada uno).
 */
const conIntl = (ui: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="es" messages={es}>
      {ui}
    </NextIntlClientProvider>
  )

const CASOS: [string, (t: number | null) => React.ReactNode][] = [
  ['agenda', (t) => <AgendaBadge initialTotal={t} />],
  ['cambios pendientes', (t) => <CambiosPendientesBadge total={t} />],
  ['mensajes', (t) => <MessagingBadge initialTotal={t} centroId="c" />],
  ['recordatorios', (t) => <RecordatoriosBadge initialTotal={t} centroId="c" />],
]

describe('los badges del menú con el contador sin leer', () => {
  it.each(CASOS)('%s: premisa, un 3 se pinta como 3', (_n, badge) => {
    conIntl(badge(3))
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.queryByTestId('contador-no-leido')).toBeNull()
  })

  it.each(CASOS)('%s: null pinta «?»', (_n, badge) => {
    conIntl(badge(null))
    expect(screen.getByTestId('contador-no-leido').textContent).toBe('?')
  })

  it.each([
    [
      'mensajes',
      'mensajes',
      h.unread,
      (t: number) => <MessagingBadge initialTotal={t} centroId="c" />,
    ],
    [
      'recordatorios',
      'recordatorios',
      h.recordatorios,
      (t: number) => <RecordatoriosBadge initialTotal={t} centroId="c" />,
    ],
  ] as const)(
    '%s: si el recuento desde el cliente falla, «?», no el número de antes',
    async (_n, clave, accion, badge) => {
      conIntl(badge(5))
      expect(screen.getByText('5'), 'premisa: el número de antes está').toBeTruthy()
      accion.mockRejectedValueOnce(new Error('fetch failed'))
      await act(async () => {
        h.onChange[clave]()
      })
      expect(screen.getByTestId('contador-no-leido').textContent).toBe('?')
      expect(screen.queryByText('5')).toBeNull()
    }
  )

  it('mensajes: un recuento nuevo que llega bien se pinta (el refresco funciona)', async () => {
    conIntl(<MessagingBadge initialTotal={5} centroId="c" />)
    h.unread.mockResolvedValueOnce({ total: 2 })
    await act(async () => {
      h.onChange.mensajes()
    })
    expect(screen.getByText('2')).toBeTruthy()
  })
})
