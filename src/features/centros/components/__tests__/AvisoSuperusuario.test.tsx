import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Fase 3 (ADR-0061): dentro de un centro, el superusuario ve siempre la banda con el nombre del
 * centro y el botón de salir. Cualquier otro usuario no ve nada, y no se consulta nada.
 */

const A = '11111111-1111-4111-8111-111111111111'

const estado = vi.hoisted(() => ({ consultas: [] as string[][] }))

vi.mock('../../queries/get-nombres-centros', () => ({
  getNombresCentros: async (ids: string[]) => {
    estado.consultas.push(ids)
    return new Map([[A, 'Centro Demo A']])
  },
}))
vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => (k: string, v?: Record<string, string>) =>
    `${ns}.${k}${v ? `(${Object.values(v).join(',')})` : ''}`,
}))
vi.mock('../../actions/salir-centro', () => ({ salirDelCentro: vi.fn() }))

const { AvisoSuperusuario } = await import('../AvisoSuperusuario')

const contexto = {
  centroId: A,
  rol: 'admin' as const,
  roles: ['admin' as const],
  centros: [{ centroId: A, rol: 'admin' as const, roles: ['admin' as const] }],
}

beforeEach(() => {
  estado.consultas = []
})

describe('AvisoSuperusuario', () => {
  it('quien no es superusuario: no pinta nada ni consulta', async () => {
    const nodo = await AvisoSuperusuario({
      locale: 'es',
      contexto: { ...contexto, esSuperusuario: false },
    })
    expect(nodo).toBeNull()
    expect(estado.consultas).toEqual([])
  })

  it('el superusuario: la banda con el centro y el botón de salir', async () => {
    const nodo = await AvisoSuperusuario({
      locale: 'es',
      contexto: { ...contexto, esSuperusuario: true },
    })
    expect(nodo).not.toBeNull()
    render(nodo!)
    expect(estado.consultas).toEqual([[A]])
    const banda = screen.getByRole('status')
    expect(banda).toHaveTextContent('centros.superusuario.etiqueta')
    expect(banda).toHaveTextContent('centros.superusuario.aviso(Centro Demo A)')
    expect(screen.getByRole('button', { name: 'centros.superusuario.salir' })).toBeInTheDocument()
  })

  it('el centro sin nombre legible: lo dice, no deja el hueco', async () => {
    const nodo = await AvisoSuperusuario({
      locale: 'es',
      contexto: {
        ...contexto,
        centroId: '99999999-9999-4999-8999-999999999999',
        esSuperusuario: true,
      },
    })
    render(nodo!)
    expect(screen.getByRole('status')).toHaveTextContent(
      'centros.superusuario.aviso(centros.elegir.sin_nombre)'
    )
  })
})
