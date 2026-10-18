import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RoleSelector } from '../RoleSelector'

/**
 * El selector de rol solo navega al panel del rol. Antes escribía una cookie `nido_active_role`
 * que no leía nadie; con la cookie del centro activo no queremos una segunda muerta al lado.
 */

const { push } = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))

describe('RoleSelector', () => {
  it('navega al panel del rol y no escribe ninguna cookie', () => {
    document.cookie.split(';').forEach((c) => {
      const nombre = c.split('=')[0]?.trim()
      if (nombre) document.cookie = `${nombre}=; Max-Age=0; Path=/`
    })
    expect(document.cookie).toBe('')

    render(<RoleSelector locale="es" roles={['admin', 'tutor_legal']} />)
    fireEvent.click(screen.getByRole('button', { name: 'roles.tutor_legal' }))

    expect(push).toHaveBeenCalledWith('/es/family')
    expect(document.cookie).toBe('')
  })
})
