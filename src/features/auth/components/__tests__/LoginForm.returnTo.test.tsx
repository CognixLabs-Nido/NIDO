import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LoginForm } from '../LoginForm'

/**
 * Tras autenticarse, el login sigue `?returnTo=` solo si es una ruta interna. Antes hacía
 * `router.push(returnTo)` a pelo: un enlace de login con `returnTo=https://…` sacaba del sitio al
 * usuario recién autenticado (redirección abierta).
 */

const { push, signInMock, params } = vi.hoisted(() => ({
  push: vi.fn(),
  signInMock: vi.fn(),
  params: { returnTo: null as string | null },
}))

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  useSearchParams: () => ({ get: (k: string) => (k === 'returnTo' ? params.returnTo : null) }),
}))
vi.mock('@/features/auth/actions/sign-in', () => ({ signIn: signInMock }))

async function entrar(returnTo: string | null) {
  params.returnTo = returnTo
  render(<LoginForm locale="es" />)
  fireEvent.change(screen.getByLabelText('auth.login.email'), {
    target: { value: 'tutor@example.test' },
  })
  fireEvent.change(screen.getByLabelText('auth.login.password'), {
    target: { value: 'una-clave-larga' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'auth.login.submit' }))
  await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
  return push.mock.calls[0]![0] as string
}

describe('LoginForm — returnTo', () => {
  beforeEach(() => {
    push.mockReset()
    signInMock
      .mockReset()
      .mockResolvedValue({ success: true, data: { userId: 'u1', esSuperusuario: false } })
  })

  it('premisa: el formulario llama a signIn con lo escrito', async () => {
    await entrar(null)
    expect(signInMock).toHaveBeenCalledWith({
      email: 'tutor@example.test',
      password: 'una-clave-larga',
    })
  })

  it('una ruta interna se respeta', async () => {
    expect(await entrar('/es/profile/invitations')).toBe('/es/profile/invitations')
  })

  it.each([
    ['URL absoluta', 'https://evil.test/es/admin'],
    ['protocol-relative', '//evil.test'],
    ['barra invertida', '/es/\\evil.test'],
    ['sin returnTo', null],
  ])('%s → reparto por rol', async (_caso, returnTo) => {
    expect(await entrar(returnTo)).toBe('/es/select-role')
  })

  describe('el superusuario', () => {
    beforeEach(() => {
      signInMock.mockResolvedValue({ success: true, data: { userId: 'u1', esSuperusuario: true } })
    })

    it('sin returnTo → el panel de plataforma, no el selector de centro', async () => {
      expect(await entrar(null)).toBe('/es/plataforma')
    })

    it('un returnTo externo no se sigue: también al panel', async () => {
      expect(await entrar('https://evil.test/es/admin')).toBe('/es/plataforma')
    })

    it('una ruta interna se respeta', async () => {
      expect(await entrar('/es/admin')).toBe('/es/admin')
    })
  })
})
