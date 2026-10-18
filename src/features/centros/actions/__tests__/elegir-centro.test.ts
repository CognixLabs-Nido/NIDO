import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La acción que fija el centro activo: es lo único que escribe la cookie, y solo con un centro
 * donde el usuario tiene rol.
 */

const A = '11111111-1111-4111-8111-111111111111'
const AJENO = '99999999-9999-4999-8999-999999999999'

const estado = vi.hoisted(() => ({
  centrosDelUsuario: [] as string[],
  escritas: [] as Array<{ nombre: string; valor: string; opciones: Record<string, unknown> }>,
}))

vi.mock('../../contexto/get-contexto-centro', () => ({
  contextoEnCentro: async (centroId: string) =>
    estado.centrosDelUsuario.includes(centroId)
      ? { centroId, rol: 'admin', roles: ['admin'], esSuperusuario: false, centros: [] }
      : null,
}))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    set: (nombre: string, valor: string, opciones: Record<string, unknown>) =>
      estado.escritas.push({ nombre, valor, opciones }),
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))

const { elegirCentro } = await import('../elegir-centro')

beforeEach(() => {
  estado.centrosDelUsuario = [A]
  estado.escritas = []
})

describe('elegirCentro', () => {
  it('un centro suyo: escribe la cookie (httpOnly, lax) y vuelve a returnTo', async () => {
    await expect(
      elegirCentro({ centroId: A, locale: 'es', returnTo: '/es/admin/recibos' })
    ).rejects.toThrow('REDIRECT:/es/admin/recibos')
    expect(estado.escritas).toEqual([
      {
        nombre: 'nido_centro_activo',
        valor: A,
        opciones: expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
      },
    ])
  })

  it('un centro que NO es suyo: no escribe nada y devuelve error', async () => {
    expect(await elegirCentro({ centroId: AJENO, locale: 'es' })).toEqual({
      success: false,
      error: 'centros.elegir.errors.no_es_tuyo',
    })
    expect(estado.escritas).toEqual([])
  })

  it.each([
    ['centro que no es un uuid', { centroId: 'x', locale: 'es' }],
    ['idioma desconocido', { centroId: A, locale: 'fr' }],
  ])('%s: inválido, sin cookie', async (_caso, entrada) => {
    expect(await elegirCentro(entrada)).toEqual({
      success: false,
      error: 'centros.elegir.errors.invalido',
    })
    expect(estado.escritas).toEqual([])
  })

  it('returnTo externo: va al reparto por rol, no fuera de NIDO', async () => {
    await expect(
      elegirCentro({ centroId: A, locale: 'es', returnTo: 'https://evil.test' })
    ).rejects.toThrow('REDIRECT:/es/select-role')
  })
})
