// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La defensa en profundidad del panel: el layout vuelve a preguntar si es superusuario, aunque el
 * proxy ya lo haya hecho. Sin sesión, a /login; sin ser superusuario, a /forbidden.
 */

const estado = vi.hoisted(() => ({ user: null as { id: string } | null, superusuario: false }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: estado.user } }) },
  }),
}))
vi.mock('@/features/centros/contexto/roles-del-usuario', () => ({
  esSuperusuario: async () => estado.superusuario,
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))

const { default: PlataformaLayout } = await import('../layout')
const params = (locale: string) => Promise.resolve({ locale })

describe('layout de /plataforma', () => {
  beforeEach(() => {
    estado.user = { id: 'u-1' }
    estado.superusuario = false
  })

  it('el superusuario ve el panel', async () => {
    estado.superusuario = true
    const el = await PlataformaLayout({ children: 'panel', params: params('es') })
    expect(el).toBeTruthy()
  })

  it('quien no es superusuario va a /forbidden', async () => {
    await expect(PlataformaLayout({ children: 'panel', params: params('en') })).rejects.toThrow(
      'REDIRECT:/en/forbidden'
    )
  })

  it('sin sesión, a /login', async () => {
    estado.user = null
    await expect(PlataformaLayout({ children: 'panel', params: params('va') })).rejects.toThrow(
      'REDIRECT:/va/login'
    )
  })
})
