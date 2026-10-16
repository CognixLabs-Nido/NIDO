import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Multicentro · Fase A: con `logo_url = NULL` (CEI Ejemplo), `getCentroLogo` devuelve null y
 * los layouts no pintan el logo. Si devolviera `{ logoUrl: null }`, `CentroLogo` recibiría una
 * URL vacía y `next/image` rompería la pantalla.
 */

const fila = vi.hoisted(() => ({ actual: null as Record<string, unknown> | null }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        is: () => q,
        maybeSingle: async () => ({ data: fila.actual, error: null }),
      }
      return q
    },
  }),
}))

const { getCentroLogo } = await import('../get-centro-logo')

describe('getCentroLogo', () => {
  beforeEach(() => {
    fila.actual = null
  })

  it('control: con logo, devuelve la URL y el nombre', async () => {
    fila.actual = { logo_url: '/brand/centro-demo.png', nombre: 'Centro Demo' }
    expect(await getCentroLogo('c-con-logo')).toEqual({
      logoUrl: '/brand/centro-demo.png',
      nombre: 'Centro Demo',
    })
  })

  it('logo_url NULL: devuelve null', async () => {
    fila.actual = { logo_url: null, nombre: 'CEI Ejemplo' }
    expect(await getCentroLogo('c-sin-logo')).toBeNull()
  })

  it('centro inexistente o borrado: devuelve null', async () => {
    expect(await getCentroLogo('c-no-existe')).toBeNull()
  })
})
