import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SidebarNav } from '../SidebarNav'

/**
 * Multicentro · Fase A: CEI Ejemplo se queda sin logo (`logo_url = NULL`). La barra lateral
 * y la cabecera móvil tienen que seguir enteras, con el logo de NIDO y la navegación, y sin
 * hueco ni separador del logo del centro.
 */

vi.mock('next/navigation', () => ({ usePathname: () => '/es/admin' }))

const PROPS = {
  locale: 'es',
  items: [{ href: '/es/admin', label: 'Inicio', icon: <svg /> }],
  user: { name: 'Directora Demo', roleLabel: 'Dirección' },
  profileHref: '/es/profile',
  profileLabel: 'Perfil',
  ariaLabel: 'Navegación',
}

const NOMBRE_CENTRO = 'Centro Demo'

describe('SidebarNav sin logo del centro', () => {
  it('control: con logo, se pinta en la barra lateral y en la cabecera móvil', () => {
    render(
      <SidebarNav {...PROPS} centroLogo={{ url: '/brand/centro-demo.png', name: NOMBRE_CENTRO }} />
    )
    expect(screen.getAllByAltText(NOMBRE_CENTRO)).toHaveLength(2)
  })

  it.each([null, undefined])('centroLogo %s: sin logo del centro y el resto intacto', (logo) => {
    const { container } = render(<SidebarNav {...PROPS} centroLogo={logo} />)
    expect(screen.queryByAltText(NOMBRE_CENTRO)).toBeNull()
    // Solo quedan las imágenes de NIDO (wordmark en escritorio y marca en móvil).
    const imagenes = Array.from(container.querySelectorAll('img'))
    expect(imagenes.length).toBeGreaterThan(0)
    for (const img of imagenes) expect(img.getAttribute('src')).toContain('nido-logo')
    expect(screen.getAllByRole('link', { name: 'Inicio' }).length).toBeGreaterThan(0)
    expect(screen.getByText('Directora Demo')).toBeTruthy()
  })
})
