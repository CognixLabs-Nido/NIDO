import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Multicentro · Fase 1 — quien tiene UN centro no ve nunca el conmutador (ni se consultan
 * nombres); con dos, aparece con los nombres y el actual marcado.
 */

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

const estado = vi.hoisted(() => ({ consultas: 0 }))

vi.mock('../../queries/get-nombres-centros', () => ({
  getNombresCentros: async () => {
    estado.consultas++
    return new Map([
      [A, 'Centro Demo A'],
      [B, 'Centro Demo B'],
    ])
  },
}))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }))
vi.mock('../../actions/elegir-centro', () => ({ elegirCentro: vi.fn() }))

const { ConmutadorCentroServidor } = await import('../ConmutadorCentroServidor')

const base = { rol: 'admin' as const, roles: ['admin' as const], esSuperusuario: false }

beforeEach(() => {
  estado.consultas = 0
})

describe('ConmutadorCentroServidor', () => {
  it('un centro: no pinta nada ni consulta nombres', async () => {
    const nodo = await ConmutadorCentroServidor({
      locale: 'es',
      contexto: {
        ...base,
        centroId: A,
        centros: [{ centroId: A, rol: 'admin', roles: ['admin'] }],
      },
    })
    expect(nodo).toBeNull()
    expect(estado.consultas).toBe(0)
  })

  it('dos centros: el conmutador con los dos nombres y el actual marcado', async () => {
    const nodo = await ConmutadorCentroServidor({
      locale: 'es',
      contexto: {
        ...base,
        centroId: B,
        centros: [
          { centroId: A, rol: 'admin', roles: ['admin'] },
          { centroId: B, rol: 'tutor_legal', roles: ['tutor_legal'] },
        ],
      },
    })
    render(<>{nodo}</>)
    expect(screen.getByText('cambiar')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Centro Demo A' })).toBeTruthy()
    const actual = screen.getByRole('button', { name: 'Centro Demo B' })
    expect(actual.getAttribute('aria-current')).toBe('true')
    expect((actual as HTMLButtonElement).disabled).toBe(true)
  })
})
