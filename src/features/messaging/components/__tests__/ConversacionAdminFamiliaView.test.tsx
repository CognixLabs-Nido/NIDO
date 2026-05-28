import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ConversacionAdminFamiliaHeader } from '../../types'
import { ConversacionAdminFamiliaView } from '../ConversacionAdminFamiliaView'

/**
 * Tests de F5.6-A: vista del hilo admin↔familia.
 *
 *  - Badge "Dirección" visible siempre.
 *  - Header muestra el nombre del OTRO miembro del par según rolEnHilo.
 *  - Indicador "Se cierra el {fecha}" cuando activa; "Cerrada el {fecha}"
 *    cuando caducada.
 *  - Botón "Reabrir conversación" SOLO cuando rolEnHilo === 'admin' Y
 *    caducada.
 *  - Composer deshabilitado cuando caducada.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    if (vars && Object.keys(vars).length > 0) {
      return `${key}:${JSON.stringify(vars)}`
    }
    return key
  },
}))

vi.mock('../../lib/use-messaging-realtime', () => ({
  useMessagingRealtime: () => undefined,
}))

vi.mock('../../actions/marcar-conversacion-leida', () => ({
  marcarConversacionLeida: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('../../actions/enviar-mensaje', () => ({
  enviarMensaje: vi.fn(),
}))

vi.mock('../../actions/abrir-conversacion-admin-familia', () => ({
  abrirConversacionAdminFamilia: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

function header(expiresAt: string): ConversacionAdminFamiliaHeader {
  return {
    id: 'conv-1',
    admin_id: 'admin-1',
    admin_nombre: 'Lucía (Dirección)',
    tutor_id: 'tutor-1',
    tutor_nombre: 'María (madre)',
    expires_at: expiresAt,
  }
}

describe('ConversacionAdminFamiliaView', () => {
  it('admin viendo hilo activo: badge Dirección + nombre del tutor + sin botón reabrir', () => {
    const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
    render(
      <ConversacionAdminFamiliaView
        locale="es"
        rolEnHilo="admin"
        header={header(future)}
        mensajes={[]}
      />
    )
    expect(screen.getByTestId('badge-direccion')).not.toBeNull()
    // El admin ve al tutor como contraparte.
    expect(screen.getByText('María (madre)')).not.toBeNull()
    // Indicador activo (clave + variables interpoladas por el mock — el
    // mock de useTranslations devuelve la KEY sin el namespace).
    const indicador = screen.getByTestId('indicador-caducidad')
    expect(indicador.textContent ?? '').toContain('indicador_activo')
    // Sin botón reabrir.
    expect(screen.queryByTestId('reabrir-conversacion')).toBeNull()
  })

  it('tutor viendo hilo activo: ve al admin como contraparte', () => {
    const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
    render(
      <ConversacionAdminFamiliaView
        locale="es"
        rolEnHilo="tutor"
        header={header(future)}
        mensajes={[]}
      />
    )
    expect(screen.getByText('Lucía (Dirección)')).not.toBeNull()
    // El tutor NUNCA ve botón reabrir, ni activa ni caducada.
    expect(screen.queryByTestId('reabrir-conversacion')).toBeNull()
  })

  it('admin con hilo CADUCADO: muestra botón "Reabrir conversación" y composer deshabilitado', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    render(
      <ConversacionAdminFamiliaView
        locale="es"
        rolEnHilo="admin"
        header={header(past)}
        mensajes={[]}
      />
    )
    expect(screen.getByTestId('reabrir-conversacion')).not.toBeNull()
    // Composer deshabilitado por caducidad.
    expect(screen.getByTestId('composer-cerrado')).not.toBeNull()
    const indicador = screen.getByTestId('indicador-caducidad')
    expect(indicador.textContent ?? '').toContain('indicador_cerrada')
  })

  it('tutor con hilo CADUCADO: composer deshabilitado pero SIN botón reabrir', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    render(
      <ConversacionAdminFamiliaView
        locale="es"
        rolEnHilo="tutor"
        header={header(past)}
        mensajes={[]}
      />
    )
    expect(screen.getByTestId('composer-cerrado')).not.toBeNull()
    expect(screen.queryByTestId('reabrir-conversacion')).toBeNull()
  })
})
