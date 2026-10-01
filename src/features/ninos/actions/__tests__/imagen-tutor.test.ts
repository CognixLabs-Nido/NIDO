import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Revocar / volver a autorizar la imagen de un niño desde el portal de familia.
 *
 *  revocarImagenNino (IU-4, ahora también el tutor):
 *   - tutor legal de ESE niño → revoca + borra la foto de perfil + revalida familia.
 *   - Dirección del centro → igual que antes (no se rompe IU-4).
 *   - ni admin ni tutor legal (p. ej. tutor de otro niño, vínculo `autorizado`) → no
 *     autorizado SIN llamar a la RPC ni tocar la foto (sin estado parcial).
 *  otorgarImagenNino:
 *   - tutor legal → otorga a SU nombre (p_tutor = él), método checkbox.
 *   - no tutor legal → no autorizado sin llamar a la RPC.
 *   - ya tiene uno vigente → no duplica.
 *   - 42501 de la RPC → no autorizado; devuelve `visible` del flag derivado.
 */

const USER = '11111111-1111-4111-8111-111111111111'
const NINO = '22222222-2222-4222-8222-222222222222'
const CENTRO = '33333333-3333-4333-8333-333333333333'
const FOTO = `${CENTRO}/${NINO}/perfil.jpg`

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClientMock() }))

const serviceUpdateSpy = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      update: (patch: unknown) => ({
        eq: () => {
          serviceUpdateSpy(patch)
          return Promise.resolve({ error: null })
        },
      }),
    }),
  }),
}))

const borrarSpy = vi.fn()
vi.mock('@/shared/lib/adjuntos/storage', () => ({
  BUCKET_NINOS_FOTOS: 'ninos-fotos',
  borrarObjetosBucket: (...args: unknown[]) => {
    borrarSpy(...args)
    return Promise.resolve()
  },
  rutaThumbDe: (p: string) => `${p}.thumb`,
}))

const revalidateSpy = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidateSpy(...a) }))

vi.mock('@/features/autorizaciones/lib/request-context', () => ({
  getRequestContext: () => Promise.resolve({ ip: '10.0.0.1', userAgent: 'test-ua' }),
}))

import { otorgarImagenNino } from '../otorgar-imagen-nino'
import { revocarImagenNino } from '../revocar-imagen-nino'

interface Setup {
  user?: { id: string } | null
  esAdmin?: boolean
  esTutorLegal?: boolean
  nino?: { id: string; centro_id: string; foto_url: string | null } | null
  miVigente?: { id: string } | null
  flagTras?: boolean
  rpcError?: { code?: string; message: string } | null
}

function makeFake(s: Setup) {
  const rpcSpy = vi.fn()
  // Builder encadenable: select/eq/is/limit devuelven el mismo objeto; maybeSingle resuelve
  // con la fila configurada para la tabla.
  const builder = (table: string) => {
    const b = {
      select: () => b,
      eq: () => b,
      is: () => b,
      limit: () => b,
      maybeSingle: () => {
        if (table === 'consentimientos') return Promise.resolve({ data: s.miVigente ?? null })
        if (table === 'ninos') {
          return Promise.resolve({
            data:
              s.nino === undefined
                ? {
                    id: NINO,
                    centro_id: CENTRO,
                    foto_url: FOTO,
                    puede_aparecer_en_fotos: s.flagTras,
                  }
                : s.nino && { ...s.nino, puede_aparecer_en_fotos: s.flagTras },
          })
        }
        return Promise.resolve({ data: null })
      },
    }
    return b
  }
  const fake = {
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: s.user === undefined ? { id: USER } : s.user } }),
    },
    from: (table: string) => builder(table),
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcSpy(fn, args)
      if (fn === 'es_admin') return Promise.resolve({ data: s.esAdmin ?? false })
      if (fn === 'es_tutor_legal_de') return Promise.resolve({ data: s.esTutorLegal ?? false })
      return Promise.resolve({ data: 1, error: s.rpcError ?? null })
    },
  }
  return { fake, rpcSpy }
}

const llamadas = (spy: ReturnType<typeof vi.fn>, fn: string) =>
  spy.mock.calls.filter((c) => c[0] === fn)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('revocarImagenNino — tutor legal y Dirección', () => {
  it('tutor legal de ese niño: revoca, borra la foto de perfil y revalida la ficha de familia', async () => {
    const { fake, rpcSpy } = makeFake({ esTutorLegal: true })
    createClientMock.mockReturnValue(fake)

    const r = await revocarImagenNino({ nino_id: NINO })

    expect(r.success).toBe(true)
    expect(llamadas(rpcSpy, 'revocar_consentimiento_imagen')).toEqual([
      ['revocar_consentimiento_imagen', { p_nino_id: NINO }],
    ])
    expect(serviceUpdateSpy).toHaveBeenCalledWith({ foto_url: null })
    expect(borrarSpy).toHaveBeenCalledWith(expect.anything(), 'ninos-fotos', [
      FOTO,
      `${FOTO}.thumb`,
    ])
    expect(revalidateSpy).toHaveBeenCalledWith('/[locale]/family/nino/[id]', 'page')
    expect(revalidateSpy).toHaveBeenCalledWith('/[locale]/admin/ninos/[id]', 'page')
  })

  it('Dirección del centro sigue pudiendo (IU-4 intacto)', async () => {
    const { fake, rpcSpy } = makeFake({ esAdmin: true })
    createClientMock.mockReturnValue(fake)

    const r = await revocarImagenNino({ nino_id: NINO })

    expect(r.success).toBe(true)
    expect(llamadas(rpcSpy, 'revocar_consentimiento_imagen')).toHaveLength(1)
    expect(llamadas(rpcSpy, 'es_admin')).toEqual([['es_admin', { p_centro_id: CENTRO }]])
  })

  it('ni admin ni tutor legal: no autorizado, sin revocar ni tocar la foto', async () => {
    const { fake, rpcSpy } = makeFake({})
    createClientMock.mockReturnValue(fake)

    const r = await revocarImagenNino({ nino_id: NINO })

    expect(r).toEqual({ success: false, error: 'nino.imagen.errors.no_autorizado' })
    expect(llamadas(rpcSpy, 'es_tutor_legal_de')).toEqual([
      ['es_tutor_legal_de', { p_nino_id: NINO }],
    ])
    expect(llamadas(rpcSpy, 'revocar_consentimiento_imagen')).toHaveLength(0)
    expect(serviceUpdateSpy).not.toHaveBeenCalled()
    expect(borrarSpy).not.toHaveBeenCalled()
  })

  it('niño no visible por RLS (no es suyo): no autorizado sin consultar nada más', async () => {
    const { fake, rpcSpy } = makeFake({ esTutorLegal: true, nino: null })
    createClientMock.mockReturnValue(fake)

    const r = await revocarImagenNino({ nino_id: NINO })

    expect(r).toEqual({ success: false, error: 'nino.imagen.errors.no_autorizado' })
    expect(rpcSpy).not.toHaveBeenCalled()
  })
})

describe('otorgarImagenNino — el tutor vuelve a autorizar', () => {
  it('tutor legal sin consentimiento vigente: otorga a SU nombre y devuelve visible', async () => {
    const { fake, rpcSpy } = makeFake({ esTutorLegal: true, flagTras: true })
    createClientMock.mockReturnValue(fake)

    const r = await otorgarImagenNino({ nino_id: NINO })

    expect(r).toEqual({ success: true, data: { visible: true } })
    const otorgar = llamadas(rpcSpy, 'otorgar_consentimiento_imagen')
    expect(otorgar).toHaveLength(1)
    expect(otorgar[0][1]).toMatchObject({
      p_nino_id: NINO,
      p_tutor: USER,
      p_metodo: 'checkbox',
      p_ip: '10.0.0.1',
      p_user_agent: 'test-ua',
    })
    expect(revalidateSpy).toHaveBeenCalledWith('/[locale]/family/nino/[id]', 'page')
  })

  it('doble consentimiento sin el otro tutor: otorga pero visible=false', async () => {
    const { fake } = makeFake({ esTutorLegal: true, flagTras: false })
    createClientMock.mockReturnValue(fake)

    const r = await otorgarImagenNino({ nino_id: NINO })

    expect(r).toEqual({ success: true, data: { visible: false } })
  })

  it('ya tiene uno vigente: no lo duplica', async () => {
    const { fake, rpcSpy } = makeFake({
      esTutorLegal: true,
      miVigente: { id: 'c1' },
      flagTras: true,
    })
    createClientMock.mockReturnValue(fake)

    const r = await otorgarImagenNino({ nino_id: NINO })

    expect(r.success).toBe(true)
    expect(llamadas(rpcSpy, 'otorgar_consentimiento_imagen')).toHaveLength(0)
  })

  it('no es tutor legal de ese niño (aunque fuera admin): no autorizado sin llamar a la RPC', async () => {
    const { fake, rpcSpy } = makeFake({ esAdmin: true, esTutorLegal: false })
    createClientMock.mockReturnValue(fake)

    const r = await otorgarImagenNino({ nino_id: NINO })

    expect(r).toEqual({ success: false, error: 'nino.imagen.errors.no_autorizado_otorgar' })
    expect(llamadas(rpcSpy, 'otorgar_consentimiento_imagen')).toHaveLength(0)
  })

  it('42501 de la RPC → no autorizado', async () => {
    const { fake } = makeFake({
      esTutorLegal: true,
      rpcError: { code: '42501', message: 'no autorizado' },
    })
    createClientMock.mockReturnValue(fake)

    const r = await otorgarImagenNino({ nino_id: NINO })

    expect(r).toEqual({ success: false, error: 'nino.imagen.errors.no_autorizado_otorgar' })
  })

  it('sin sesión: no autorizado', async () => {
    const { fake, rpcSpy } = makeFake({ user: null })
    createClientMock.mockReturnValue(fake)

    const r = await otorgarImagenNino({ nino_id: NINO })

    expect(r).toEqual({ success: false, error: 'nino.imagen.errors.no_autorizado_otorgar' })
    expect(rpcSpy).not.toHaveBeenCalled()
  })
})
