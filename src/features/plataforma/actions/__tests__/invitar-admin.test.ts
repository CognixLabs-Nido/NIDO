import { beforeEach, describe, expect, it, vi } from 'vitest'

import { invitarAdmin } from '../invitar-admin'

/**
 * `invitarAdmin` pide a `platform_invitar_admin` la invitación (nueva con email, la última sin él) y
 * manda el correo a quien diga la invitación escrita, en el idioma del centro.
 */

const { rpc, filas, enviarCorreo } = vi.hoisted(() => ({
  rpc: vi.fn(),
  filas: {
    invitaciones: { data: { email: 'guardado@example.test' } as unknown, error: null },
    centros: { data: { idioma_default: 'en' } as unknown, error: null },
  },
  enviarCorreo: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    from: (tabla: 'invitaciones' | 'centros') => ({
      select: () => ({ eq: () => ({ single: async () => filas[tabla] }) }),
    }),
  }),
}))
vi.mock('@/features/auth/lib/correo-invitacion', () => ({ enviarCorreoInvitacion: enviarCorreo }))

const CENTRO = '11111111-1111-4111-8111-111111111111'

describe('invitarAdmin', () => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: 'i9', error: null })
    enviarCorreo.mockReset().mockResolvedValue(null)
  })

  it('premisa: con email, la RPC lo recibe y el correo va a quien dice la invitación', async () => {
    expect(await invitarAdmin({ centroId: CENTRO, email: 'nueva@example.test' })).toEqual({
      success: true,
      data: { invitationId: 'i9' },
    })
    expect(rpc).toHaveBeenCalledWith('platform_invitar_admin', {
      p_centro_id: CENTRO,
      p_email: 'nueva@example.test',
    })
    expect(enviarCorreo.mock.calls[0]![1]).toEqual({
      invitationId: 'i9',
      email: 'guardado@example.test',
      rolObjetivo: 'admin',
      centroId: CENTRO,
      idioma: 'en',
    })
  })

  it('sin email: reenviar (la RPC no recibe email)', async () => {
    await invitarAdmin({ centroId: CENTRO })
    expect(rpc).toHaveBeenCalledWith('platform_invitar_admin', {
      p_centro_id: CENTRO,
      p_email: undefined,
    })
    expect(enviarCorreo).toHaveBeenCalledTimes(1)
  })

  it('el centro ya tiene admin: 55000, sin correo', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '55000', hint: 'centro_con_admin' } })
    expect(await invitarAdmin({ centroId: CENTRO, email: 'x@example.test' })).toEqual({
      success: false,
      error: 'plataforma.errores.centro_con_admin',
    })
    expect(enviarCorreo).not.toHaveBeenCalled()
  })

  it('el correo no sale: se dice', async () => {
    enviarCorreo.mockResolvedValue('auth.invitation.errors.email_no_enviado')
    expect(await invitarAdmin({ centroId: CENTRO })).toEqual({
      success: false,
      error: 'auth.invitation.errors.email_no_enviado',
    })
  })
})
