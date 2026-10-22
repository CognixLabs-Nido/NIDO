import { beforeEach, describe, expect, it, vi } from 'vitest'

import { crearCentro } from '../crear-centro'

/**
 * `crearCentro` llama a `platform_crear_centro` con la sesión (la BD es la puerta) y después manda
 * el correo de la invitación de admin en el idioma del centro. Si el correo no sale, el centro ya
 * está creado: lo devuelve como `errorCorreo`, no como fallo.
 */

const { rpc, single, enviarCorreo } = vi.hoisted(() => ({
  rpc: vi.fn(),
  single: vi.fn(),
  enviarCorreo: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: () => ({ servicio: true }) }))
vi.mock('@/features/auth/lib/correo-invitacion', () => ({ enviarCorreoInvitacion: enviarCorreo }))

const ENTRADA = {
  nombre: 'Centro Demo',
  direccion: 'Calle Demo 1',
  telefono: '600000000',
  email_contacto: 'contacto@example.test',
  idioma_default: 'va' as const,
  curso_nombre: '2026-27',
  curso_inicio: '2026-09-01',
  curso_fin: '2027-07-31',
  email_admin: 'admin@example.test',
}

describe('crearCentro', () => {
  beforeEach(() => {
    rpc.mockReset().mockReturnValue({ single })
    single
      .mockReset()
      .mockResolvedValue({ data: { centro_id: 'c1', invitacion_id: 'i1' }, error: null })
    enviarCorreo.mockReset().mockResolvedValue(null)
  })

  it('premisa: llama a la RPC con lo del formulario y manda el correo de admin', async () => {
    expect(await crearCentro(ENTRADA)).toEqual({
      success: true,
      data: { centroId: 'c1', errorCorreo: null },
    })
    expect(rpc).toHaveBeenCalledWith('platform_crear_centro', {
      p_nombre: 'Centro Demo',
      p_direccion: 'Calle Demo 1',
      p_telefono: '600000000',
      p_email_contacto: 'contacto@example.test',
      p_idioma: 'va',
      p_curso_nombre: '2026-27',
      p_curso_inicio: '2026-09-01',
      p_curso_fin: '2027-07-31',
      p_email_admin: 'admin@example.test',
    })
    expect(enviarCorreo).toHaveBeenCalledWith(
      { servicio: true },
      {
        invitationId: 'i1',
        email: 'admin@example.test',
        rolObjetivo: 'admin',
        centroId: 'c1',
        idioma: 'va',
      }
    )
  })

  it('el correo no sale: el centro está creado y se dice', async () => {
    enviarCorreo.mockResolvedValue('auth.invitation.errors.email_no_enviado')
    expect(await crearCentro(ENTRADA)).toEqual({
      success: true,
      data: { centroId: 'c1', errorCorreo: 'auth.invitation.errors.email_no_enviado' },
    })
  })

  it('sin email de admin no llega a la BD', async () => {
    const r = await crearCentro({ ...ENTRADA, email_admin: '' })
    expect(r).toEqual({ success: false, error: 'plataforma.errores.email_admin' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('la BD dice que el nombre está repetido: no se manda correo', async () => {
    single.mockResolvedValue({ data: null, error: { code: '23505', hint: 'nombre_duplicado' } })
    expect(await crearCentro(ENTRADA)).toEqual({
      success: false,
      error: 'plataforma.errores.nombre_duplicado',
    })
    expect(enviarCorreo).not.toHaveBeenCalled()
  })

  it('quien no es la plataforma: 42501 de la BD', async () => {
    single.mockResolvedValue({ data: null, error: { code: '42501' } })
    expect(await crearCentro(ENTRADA)).toEqual({
      success: false,
      error: 'plataforma.errores.no_autorizado',
    })
  })
})
