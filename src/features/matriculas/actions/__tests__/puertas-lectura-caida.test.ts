// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Censo C (B1, lista blanca, 2026-11-26).
 *  - Las puertas de «anular el alta sin terminar» y «cancelar la invitación del segundo tutor»: con la
 *    lectura del niño caída decían «esta alta ya no está» / «ya no hay segundo tutor». Ahora
 *    `lectura_fallida`.
 *  - `borrarCuentasDeAuth`: sin el listado de avatares, el de la cuenta borrada se quedaba en el bucket sin
 *    que nadie lo supiera. No para a las demás, pero va a Sentry.
 * Cada caso con su premisa. Fixtures ficticios.
 */
const { estado, logError } = vi.hoisted(() => ({
  estado: {
    nino: null as { centro_id: string } | null,
    ninoCaido: false,
    listarFalla: false,
    borradas: [] as string[],
  },
  logError: vi.fn(),
}))
const CAIDA = { code: 'XX000', message: 'caída' }

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/shared/lib/logger', () => ({ logger: { error: logError, warn: vi.fn() } }))
vi.mock('@/features/auth/lib/llamar-gotrue', () => ({
  llamarGoTrue: async (_l: string, fn: () => Promise<{ data: unknown }>) => ({
    data: (await fn()).data,
    indisponible: false,
  }),
}))
vi.mock('@/features/auth/actions/send-invitation', () => ({ sendInvitation: vi.fn() }))
vi.mock('@/features/centros/contexto/roles-del-usuario', () => ({
  usuarioAdminEn: async () => 'u-1',
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    rpc: async () => ({ data: [], error: null }),
  }),
}))
const service = {
  from: () => {
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is']) c[m] = () => c
    c.maybeSingle = async () =>
      estado.ninoCaido ? { data: null, error: CAIDA } : { data: estado.nino, error: null }
    return c
  },
  storage: {
    from: () => ({
      list: async () =>
        estado.listarFalla ? { data: null, error: CAIDA } : { data: [], error: null },
      remove: async () => ({ error: null }),
    }),
  },
  auth: {
    admin: {
      deleteUser: async (id: string) => {
        estado.borradas.push(id)
        return { error: null }
      },
      updateUserById: async () => ({ error: null }),
    },
  },
}
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: () => service }))

const { anularAlta } = await import('../alta-sin-terminar')
const { cancelarInvitacionTutor2 } = await import('../invitacion-tutor2')
const { borrarCuentasDeAuth } = await import('../../lib/alta-sin-terminar')

const NINO = '00000000-0000-4000-8000-000000000001'
const LECTURA_FALLIDA = { success: false, error: 'common.lectura_fallida' }

beforeEach(() => {
  estado.nino = null
  estado.ninoCaido = false
  estado.listarFalla = false
  estado.borradas = []
  logError.mockClear()
})

describe('las puertas, con el niño sin leer', () => {
  it('premisa: sin el niño, «el alta ya no está» y «ya no hay segundo tutor»', async () => {
    expect(await anularAlta(NINO)).toEqual({ success: false, error: 'matricula.errors.alta_ya_no' })
    expect(await cancelarInvitacionTutor2(NINO)).toEqual({
      success: false,
      error: 'matricula.errors.tutor2_ya_no',
    })
  })

  it('con la lectura caída: lectura_fallida en las dos', async () => {
    estado.ninoCaido = true
    expect(await anularAlta(NINO)).toEqual(LECTURA_FALLIDA)
    expect(await cancelarInvitacionTutor2(NINO)).toEqual(LECTURA_FALLIDA)
  })
})

describe('borrarCuentasDeAuth', () => {
  const s = service as never
  it('premisa: borra las cuentas y nada va a Sentry', async () => {
    await borrarCuentasDeAuth(s, ['c-1', 'c-2'])
    expect(estado.borradas).toEqual(['c-1', 'c-2'])
    expect(logError).not.toHaveBeenCalled()
  })

  it('sin el listado de avatares: sigue con las demás, y va a Sentry', async () => {
    estado.listarFalla = true
    await borrarCuentasDeAuth(s, ['c-1', 'c-2'])
    expect(estado.borradas).toEqual(['c-1', 'c-2'])
    expect(logError.mock.calls.map((c) => String(c[0]))).toContainEqual(
      expect.stringContaining('avatares de la cuenta')
    )
  })
})
