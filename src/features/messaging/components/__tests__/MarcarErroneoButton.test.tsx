import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MarcarErroneoButton } from '../MarcarErroneoButton'

/**
 * Tests del componente MarcarErroneoButton (F5.6-B).
 *
 * Cubre el early-return null cuando `createdAt` queda fuera de la ventana
 * de 5 minutos. El happy-path (dialog + confirm + dispatch a la action
 * correcta) está cubierto indirectamente por los tests de ConversacionView
 * y AnuncioView en el suite mayor; aquí solo testamos la barrera temporal
 * que añade C3.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('../../actions/marcar-mensaje-erroneo', () => ({
  marcarMensajeErroneo: vi.fn(),
}))
vi.mock('../../actions/marcar-anuncio-erroneo', () => ({
  marcarAnuncioErroneo: vi.fn(),
}))

describe('MarcarErroneoButton — ventana de 5 min', () => {
  it('createdAt reciente (<5 min): renderiza el botón', () => {
    const recent = new Date(Date.now() - 60_000).toISOString() // hace 1 min
    render(<MarcarErroneoButton target="mensaje" id="m-1" createdAt={recent} inline />)
    // El label del botón viene del mock como la propia key "boton".
    expect(screen.queryByText('boton')).not.toBeNull()
  })

  it('createdAt antiguo (>5 min): early-return null, NO renderiza nada', () => {
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString() // hace 10 min
    const { container } = render(
      <MarcarErroneoButton target="mensaje" id="m-2" createdAt={old} inline />
    )
    expect(container.firstChild).toBeNull()
    expect(screen.queryByText('boton')).toBeNull()
  })

  it('createdAt justo en el límite (5 min exactos): no renderiza', () => {
    const onTheEdge = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const { container } = render(
      <MarcarErroneoButton target="anuncio" id="a-1" createdAt={onTheEdge} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('createdAt apenas dentro (4 min 59 s): renderiza', () => {
    const justInside = new Date(Date.now() - (5 * 60 * 1000 - 1_000)).toISOString()
    render(<MarcarErroneoButton target="anuncio" id="a-2" createdAt={justInside} />)
    expect(screen.queryByText('boton')).not.toBeNull()
  })
})
