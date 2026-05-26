import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { NinoMensajeriaItem } from '../../queries/get-ninos-mensajeria'
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
      />
    )
    // Sin pestañas: el único bloque es el de anuncios.
    expect(screen.queryByRole('tablist')).toBeNull()
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
      />
    )
    expect(screen.getByLabelText('split.aside_label')).not.toBeNull()
    expect(screen.getByTestId('conv-list-item-h1')).not.toBeNull()
    expect(screen.getByTestId('conv-list-item-h2')).not.toBeNull()
  })
})
