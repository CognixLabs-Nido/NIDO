import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EstadoCentro } from '../../contexto/get-contexto-centro'

/**
 * Decisión de Jose (multicentro · Fase 1): una página de un aula o un niño de otro centro se ve
 * igual, pero la cabecera dice qué centro estás viendo. Quien tiene un centro no lo ve nunca (ni se
 * consultan nombres).
 */

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

const estado = vi.hoisted(() => ({
  consultas: 0,
  actual: { tipo: 'sin_sesion' } as unknown,
}))

vi.mock('../../contexto/get-contexto-centro', () => ({
  getEstadoCentro: async () => estado.actual,
}))
vi.mock('../../queries/get-nombres-centros', () => ({
  getNombresCentros: async () => {
    estado.consultas++
    return new Map([
      [A, 'Centro Demo A'],
      [B, 'Centro Demo B'],
    ])
  },
}))
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (k: string, v?: Record<string, string>) =>
    v ? `${k}|${Object.values(v).join('|')}` : k,
}))

const { AvisoCentroDistinto } = await import('../AvisoCentroDistinto')

const centroA = {
  centroId: A,
  rol: 'admin' as const,
  roles: ['admin' as const],
  esResponsable: true,
}
const centroB = {
  centroId: B,
  rol: 'profe' as const,
  roles: ['profe' as const],
  esResponsable: false,
}

function activo(centroId: string, centros: (typeof centroA | typeof centroB)[]): EstadoCentro {
  return {
    tipo: 'activo',
    contexto: {
      centroId,
      rol: 'admin',
      roles: ['admin'],
      esResponsable: true,
      esSuperusuario: false,
      centros,
    },
  }
}

beforeEach(() => {
  estado.consultas = 0
})

describe('AvisoCentroDistinto', () => {
  it('un centro: nada, ni consulta nombres, aunque el registro sea de otro centro', async () => {
    // Registro de B y usuario solo con A: lo que lo calla es tener UN centro, no que coincida.
    estado.actual = activo(A, [centroA])
    expect(await AvisoCentroDistinto({ centroRegistroId: B })).toBeNull()
    expect(estado.consultas).toBe(0)
  })

  it('dos centros y el registro es del activo: nada', async () => {
    estado.actual = activo(A, [centroA, centroB])
    expect(await AvisoCentroDistinto({ centroRegistroId: A })).toBeNull()
    expect(estado.consultas).toBe(0)
  })

  it('dos centros y el registro es del OTRO: «estás viendo B, no A»', async () => {
    estado.actual = activo(A, [centroA, centroB])
    render((await AvisoCentroDistinto({ centroRegistroId: B }))!)
    expect(screen.getByRole('status').textContent).toBe(
      'aviso.otro_centro|Centro Demo B|Centro Demo A'
    )
  })

  it('varios centros sin elegir: «estás viendo B»', async () => {
    estado.actual = {
      tipo: 'elegir',
      centros: [centroA, centroB],
      esSuperusuario: false,
    } satisfies EstadoCentro
    render((await AvisoCentroDistinto({ centroRegistroId: B }))!)
    expect(screen.getByRole('status').textContent).toBe('aviso.viendo|Centro Demo B')
  })
})
