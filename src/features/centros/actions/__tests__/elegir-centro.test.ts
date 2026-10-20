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
  superusuario: false,
  /** Las llamadas a RPC y el error que devuelve registrar_entrada_superusuario. */
  rpcs: [] as Array<{ fn: string; args: unknown }>,
  errorEntrada: null as { code: string; message: string } | null,
}))

vi.mock('../../contexto/get-contexto-centro', () => ({
  contextoEnCentro: async (centroId: string) =>
    estado.centrosDelUsuario.includes(centroId)
      ? {
          centroId,
          rol: 'admin',
          roles: ['admin'],
          esSuperusuario: estado.superusuario,
          centros: [],
        }
      : null,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: unknown) => {
      estado.rpcs.push({ fn, args })
      return { data: null, error: estado.errorEntrada }
    },
  }),
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
  estado.superusuario = false
  estado.rpcs = []
  estado.errorEntrada = null
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

  it('un usuario normal: no registra ninguna entrada, y su cookie dura un año', async () => {
    await expect(elegirCentro({ centroId: A, locale: 'es' })).rejects.toThrow('REDIRECT:')
    expect(estado.rpcs).toEqual([])
    expect(estado.escritas[0]?.opciones).toMatchObject({ maxAge: 60 * 60 * 24 * 365 })
  })

  describe('superusuario (Fase 3)', () => {
    beforeEach(() => {
      estado.superusuario = true
    })

    it('registra la entrada en ese centro ANTES de escribir la cookie, que es de sesión', async () => {
      await expect(
        elegirCentro({ centroId: A, locale: 'es', returnTo: '/es/admin' })
      ).rejects.toThrow('REDIRECT:/es/admin')
      expect(estado.rpcs).toEqual([
        { fn: 'registrar_entrada_superusuario', args: { p_centro_id: A } },
      ])
      expect(estado.escritas).toHaveLength(1)
      expect(estado.escritas[0]).toMatchObject({ nombre: 'nido_centro_activo', valor: A })
      expect(estado.escritas[0]?.opciones).not.toHaveProperty('maxAge')
      expect(estado.escritas[0]?.opciones).toMatchObject({ httpOnly: true, sameSite: 'lax' })
    })

    it('si la entrada no se puede registrar, NO entra: ni cookie ni redirección', async () => {
      estado.errorEntrada = { code: '42501', message: 'x' }
      expect(await elegirCentro({ centroId: A, locale: 'es' })).toEqual({
        success: false,
        error: 'centros.elegir.errors.entrada_no_registrada',
      })
      expect(estado.escritas).toEqual([])
    })
  })
})
