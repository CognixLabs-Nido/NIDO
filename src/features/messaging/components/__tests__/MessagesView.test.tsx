import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { NinoMensajeriaItem } from '../../queries/get-ninos-mensajeria'
import type { AdminFamiliaListItem as AdminFamiliaListItemType } from '../../types'
import { MessagesView } from '../MessagesView'

/**
 * Tests del render diferenciado por rol en MessagesView.
 *
 * Bug B post-PR #18: el tutor con 1 hijo veía la UI estilo profe (lista
 * con buscador) en lugar de aterrizar directamente en la conversación.
 * Con el fix:
 *  - admin: solo tab Anuncios (sin Conversaciones, sin lista de niños).
 *  - profe: split-view con sidebar de niños del aula.
 *  - tutor con 1 hijo: split-view SIN sidebar (panel a ancho completo).
 *  - tutor con N hijos: split-view CON sidebar de hijos.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('../../lib/use-messaging-realtime', () => ({
  useMessagingRealtime: () => undefined,
}))

vi.mock('../../actions/marcar-conversacion-leida', () => ({
  marcarConversacionLeida: vi.fn().mockResolvedValue({ success: true }),
}))

// Aislamos el split-view en estos tests por aria-label;
// no necesitamos mockear nada más.

function nino(id: string, nombre: string): NinoMensajeriaItem {
  return {
    nino_id: id,
    nombre,
    apellidos: 'Apellidos',
    aula_nombre: 'Aula Demo',
    conversacion_id: null,
    last_message_at: null,
    last_message_preview: null,
    unread_count: 0,
  }
}

describe('MessagesView — render por rol', () => {
  it('admin: NO renderiza el tab Conversaciones ni la sidebar de niños', () => {
    render(
      <MessagesView
        locale="es"
        rol="admin"
        ninos={[]}
        anuncios={[]}
        puedePublicarAnuncio={true}
        ninoSeleccionadoId={null}
        mostrarListaConversaciones={false}
        detalleHeader={null}
        detalleMensajes={[]}
        participo={false}
        adminFamiliaItems={[]}
      />
    )
    // F5.6: admin pasa de 0 tabs a 2 tabs (Anuncios + Dirección). Lo que
    // NO debe existir es el tab Conversaciones — sigue sin participar en
    // los hilos profe↔familia.
    expect(screen.getByRole('tablist')).not.toBeNull()
    expect(screen.queryByText('tabs.conversaciones')).toBeNull()
    // Tampoco hay sidebar de mensajería.
    expect(screen.queryByLabelText('split.aside_label')).toBeNull()
  })

  it('profe: muestra split-view con sidebar de niños', () => {
    render(
      <MessagesView
        locale="es"
        rol="profe"
        ninos={[nino('n1', 'Niño A'), nino('n2', 'Niño B')]}
        anuncios={[]}
        puedePublicarAnuncio={true}
        ninoSeleccionadoId={null}
        mostrarListaConversaciones={true}
        detalleHeader={null}
        detalleMensajes={[]}
        participo={false}
        adminFamiliaItems={[]}
      />
    )
    // Tabs visibles
    expect(screen.getByRole('tablist')).not.toBeNull()
    // Sidebar visible
    expect(screen.getByLabelText('split.aside_label')).not.toBeNull()
    // La lista contiene a ambos niños.
    expect(screen.getByTestId('conv-list-item-n1')).not.toBeNull()
    expect(screen.getByTestId('conv-list-item-n2')).not.toBeNull()
  })

  it('tutor con 1 hijo: muestra panel directo, SIN sidebar', () => {
    render(
      <MessagesView
        locale="es"
        rol="tutor_legal"
        ninos={[nino('n1', 'Hijo Único')]}
        anuncios={[]}
        puedePublicarAnuncio={false}
        ninoSeleccionadoId="n1"
        mostrarListaConversaciones={false}
        detalleHeader={null}
        detalleMensajes={[]}
        participo={true}
        adminFamiliaItems={[]}
      />
    )
    // Pestañas siguen visibles (Conversaciones + Anuncios).
    expect(screen.getByRole('tablist')).not.toBeNull()
    // Pero NO hay sidebar.
    expect(screen.queryByLabelText('split.aside_label')).toBeNull()
    // No hay search input.
    expect(screen.queryByPlaceholderText('split.buscar_placeholder')).toBeNull()
  })

  it('tutor con N hijos: muestra sidebar con cada hijo', () => {
    render(
      <MessagesView
        locale="es"
        rol="tutor_legal"
        ninos={[nino('h1', 'Hijo 1'), nino('h2', 'Hijo 2')]}
        anuncios={[]}
        puedePublicarAnuncio={false}
        ninoSeleccionadoId={null}
        mostrarListaConversaciones={true}
        detalleHeader={null}
        detalleMensajes={[]}
        participo={false}
        adminFamiliaItems={[]}
      />
    )
    expect(screen.getByLabelText('split.aside_label')).not.toBeNull()
    expect(screen.getByTestId('conv-list-item-h1')).not.toBeNull()
    expect(screen.getByTestId('conv-list-item-h2')).not.toBeNull()
  })

  // --- F5.6-A — sección "Dirección" del tutor + tab admin ---

  function adminFamiliaItem(
    id: string,
    expiresAt: string,
    extras?: Partial<AdminFamiliaListItemType>
  ): AdminFamiliaListItemType {
    return {
      id,
      contraparte_nombre: 'Tutor Demo',
      rol_en_hilo: 'tutor',
      expires_at: expiresAt,
      last_message_at: null,
      last_message_preview: null,
      unread_count: 0,
      ...extras,
    }
  }

  it('tutor con hilo admin_familia activo: renderiza la sección "Dirección" arriba del split', () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    render(
      <MessagesView
        locale="es"
        rol="tutor_legal"
        ninos={[nino('h1', 'Hijo 1')]}
        anuncios={[]}
        puedePublicarAnuncio={false}
        ninoSeleccionadoId={null}
        mostrarListaConversaciones={true}
        detalleHeader={null}
        detalleMensajes={[]}
        participo={false}
        adminFamiliaItems={[adminFamiliaItem('af1', future)]}
      />
    )
    expect(screen.getByTestId('admin-familia-section')).not.toBeNull()
    expect(screen.getByTestId('admin-familia-list-item-af1')).not.toBeNull()
  })

  it('tutor SIN hilo admin_familia: NO renderiza la sección "Dirección"', () => {
    render(
      <MessagesView
        locale="es"
        rol="tutor_legal"
        ninos={[nino('h1', 'Hijo 1')]}
        anuncios={[]}
        puedePublicarAnuncio={false}
        ninoSeleccionadoId={null}
        mostrarListaConversaciones={true}
        detalleHeader={null}
        detalleMensajes={[]}
        participo={false}
        adminFamiliaItems={[]}
      />
    )
    expect(screen.queryByTestId('admin-familia-section')).toBeNull()
  })

  it('admin con hilos: el tablist tiene 2 triggers (Anuncios + Dirección)', () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    render(
      <MessagesView
        locale="es"
        rol="admin"
        ninos={[]}
        anuncios={[]}
        puedePublicarAnuncio={true}
        ninoSeleccionadoId={null}
        mostrarListaConversaciones={false}
        detalleHeader={null}
        detalleMensajes={[]}
        participo={false}
        adminFamiliaItems={[adminFamiliaItem('af2', future, { unread_count: 2 })]}
      />
    )
    // shadcn Tabs lazy-renderiza el contenido del tab inactivo, así que el
    // item de la lista no es addressable. Verificamos en su lugar que el
    // tablist del admin contiene los 2 triggers que esperamos en F5.6
    // (F5 dejaba 0 tabs al admin).
    const tablist = screen.getByRole('tablist')
    const triggers = tablist.querySelectorAll('[role="tab"]')
    expect(triggers.length).toBe(2)
  })
})
