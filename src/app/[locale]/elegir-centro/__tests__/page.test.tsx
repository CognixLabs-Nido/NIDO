import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EstadoCentro } from '@/features/centros/contexto/get-contexto-centro'

/**
 * El selector de centro: quien tiene un solo centro sigue directo; el superusuario lo ve
 * siempre (Fase 3, ADR-0061). Si no, con un solo centro rebotaría entre el selector y la
 * página (requireContextoCentro le manda aquí porque tiene que elegir).
 */

const A = '11111111-1111-4111-8111-111111111111'

const estado = vi.hoisted(() => ({ actual: { tipo: 'sin_sesion' } as EstadoCentro }))

vi.mock('@/features/centros/contexto/get-contexto-centro', () => ({
  getEstadoCentro: async () => estado.actual,
}))
vi.mock('@/features/centros/queries/get-nombres-centros', () => ({
  getNombresCentros: async () => new Map([[A, 'Centro Demo A']]),
}))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))
vi.mock('@/features/centros/components/SelectorCentro', () => ({
  SelectorCentro: (props: { centros: Array<{ centroId: string }> }) => ({
    selector: props.centros.map((c) => c.centroId),
  }),
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))

const { default: ElegirCentroPage } = await import('../page')

const UNO = [{ centroId: A, rol: 'admin' as const, roles: ['admin' as const] }]
const pagina = () =>
  ElegirCentroPage({
    params: Promise.resolve({ locale: 'es' }),
    searchParams: Promise.resolve({ returnTo: '/es/admin' }),
  })

beforeEach(() => {
  estado.actual = { tipo: 'sin_sesion' }
})

describe('selector de centro', () => {
  it('un usuario con UN centro no lo ve: vuelve a donde iba', async () => {
    estado.actual = {
      tipo: 'activo',
      contexto: {
        centroId: A,
        rol: 'admin',
        roles: ['admin'],
        esSuperusuario: false,
        centros: UNO,
      },
    }
    await expect(pagina()).rejects.toThrow('REDIRECT:/es/admin')
  })

  it('el superusuario con UN solo centro lo ve (si no, rebotaría)', async () => {
    estado.actual = { tipo: 'elegir', centros: UNO, esSuperusuario: true }
    expect(JSON.stringify(await pagina())).toContain(A)
  })
})
