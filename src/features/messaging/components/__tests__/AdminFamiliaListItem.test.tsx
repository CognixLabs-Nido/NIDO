import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AdminFamiliaListItem as AdminFamiliaListItemType } from '../../types'
import { AdminFamiliaListItem } from '../AdminFamiliaListItem'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    if (vars && Object.keys(vars).length > 0) {
      return `${key}:${JSON.stringify(vars)}`
    }
    return key
  },
}))

function item(extras?: Partial<AdminFamiliaListItemType>): AdminFamiliaListItemType {
  return {
    id: 'af-1',
    contraparte_nombre: 'María (madre)',
    rol_en_hilo: 'admin',
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    last_message_at: null,
    last_message_preview: null,
    unread_count: 0,
    ...extras,
  }
}

describe('AdminFamiliaListItem', () => {
  it('renderiza badge "Dirección" y el nombre de la contraparte', () => {
    render(<AdminFamiliaListItem locale="es" item={item()} />)
    // El badge usa la clave de i18n via el mock (que devuelve la key sin namespace).
    expect(screen.getByText('direccion')).not.toBeNull()
    expect(screen.getByText('María (madre)')).not.toBeNull()
  })

  it('hilo activo: muestra indicador_activo', () => {
    render(<AdminFamiliaListItem locale="es" item={item()} />)
    const node = screen.getByTestId('admin-familia-list-item-af-1')
    expect(node.textContent ?? '').toContain('indicador_activo')
  })

  it('hilo caducado: muestra indicador_cerrada', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    render(<AdminFamiliaListItem locale="es" item={item({ expires_at: past })} />)
    const node = screen.getByTestId('admin-familia-list-item-af-1')
    expect(node.textContent ?? '').toContain('indicador_cerrada')
  })

  it('badge de no-leídos solo aparece cuando unread_count > 0', () => {
    const { rerender } = render(<AdminFamiliaListItem locale="es" item={item()} />)
    expect(screen.queryByText('3')).toBeNull()
    rerender(<AdminFamiliaListItem locale="es" item={item({ unread_count: 3 })} />)
    expect(screen.getByText('3')).not.toBeNull()
  })
})
