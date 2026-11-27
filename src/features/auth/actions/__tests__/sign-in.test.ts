import { beforeEach, describe, expect, it, vi } from 'vitest'

import { signIn } from '../sign-in'

/**
 * El superusuario entra al panel de plataforma (Fase 5), no al selector de centro: `signIn` le
 * dice al formulario si lo es. La consulta va con la sesión recién abierta (`is_superadmin` mira
 * al usuario de la sesión), así que solo se hace con las credenciales buenas.
 */

const { auth, esSuperMock, intentos } = vi.hoisted(() => ({
  auth: { signInWithPassword: vi.fn() },
  esSuperMock: vi.fn(),
  /** Lo que contesta la cuenta de intentos fallidos recientes (el freno contra la fuerza bruta). */
  intentos: { respuesta: { count: 0, error: null } as { count: number | null; error: unknown } },
}))

vi.mock('next/headers', () => ({ headers: async () => ({ get: () => null }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth }) }))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        gte: async () => intentos.respuesta,
        insert: async () => ({ error: null }),
      }
      return q
    },
  }),
}))
vi.mock('@/features/centros/contexto/roles-del-usuario', () => ({
  esSuperusuario: esSuperMock,
}))

const ENTRADA = { email: 'persona@example.test', password: 'una-clave-larga' }

describe('signIn — ¿es superusuario?', () => {
  beforeEach(() => {
    auth.signInWithPassword
      .mockReset()
      .mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    esSuperMock.mockReset()
  })

  it('premisa: con credenciales buenas entra y pregunta, con el cliente de la sesión', async () => {
    esSuperMock.mockResolvedValue(false)
    await signIn(ENTRADA)
    expect(auth.signInWithPassword).toHaveBeenCalledWith(ENTRADA)
    expect(esSuperMock).toHaveBeenCalledTimes(1)
    expect(esSuperMock.mock.calls[0]![0]).toEqual({ auth })
  })

  it('superusuario: lo dice', async () => {
    esSuperMock.mockResolvedValue(true)
    expect(await signIn(ENTRADA)).toEqual({
      success: true,
      data: { userId: 'u1', esSuperusuario: true },
    })
  })

  it('no superusuario (o la consulta falló, que cuenta como «no»): no lo dice', async () => {
    esSuperMock.mockResolvedValue(false)
    expect(await signIn(ENTRADA)).toEqual({
      success: true,
      data: { userId: 'u1', esSuperusuario: false },
    })
  })

  it('credenciales malas: no pregunta', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: 'x' } })
    expect(await signIn(ENTRADA)).toEqual({
      success: false,
      error: 'auth.login.errors.invalid_credentials',
    })
    expect(esSuperMock).not.toHaveBeenCalled()
  })
})

/**
 * El freno contra la fuerza bruta con la cuenta de intentos sin leer (censo C, B1, 2026-11-26): `count ?? 0`
 * lo apagaba. Ahora no se entra y se dice; ni se llega a probar la contraseña.
 */
describe('signIn — el freno de intentos', () => {
  beforeEach(() => {
    auth.signInWithPassword
      .mockReset()
      .mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    esSuperMock.mockReset().mockResolvedValue(false)
    intentos.respuesta = { count: 0, error: null }
  })

  it('premisa: con muchos intentos contados, frena sin probar la contraseña', async () => {
    intentos.respuesta = { count: 1_000, error: null }
    expect(await signIn(ENTRADA)).toEqual({
      success: false,
      error: 'auth.login.errors.too_many_attempts',
    })
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
  }, 10_000)

  it('sin poder contarlos: no se apaga el freno, lo dice y no prueba la contraseña', async () => {
    intentos.respuesta = { count: null, error: { code: 'XX000', message: 'caída' } }
    expect(await signIn(ENTRADA)).toEqual({ success: false, error: 'common.lectura_fallida' })
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
  })
})
