// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * PR-D (auditoría F11-D, D2) — la ruta del libro de familia fija `libro_familia_path` con la
 * RPC `fijar_libro_familia_nino` y el cliente de SESIÓN (audit con el uid real). El service
 * role queda SOLO para Storage: borrar el objeto recién subido si falla, borrar el libro
 * anterior que devuelve la RPC y firmar la URL. Nunca escribe `ninos`.
 */

const USER = '11111111-1111-4111-8111-111111111111'
const NINO = '22222222-2222-4222-8222-222222222222'
const CENTRO = '33333333-3333-4333-8333-333333333333'
const ANTERIOR = `${CENTRO}/${NINO}/viejo.pdf`

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClientMock() }))

const serviceFromSpy = vi.fn()
const SERVICE = { from: (...a: unknown[]) => serviceFromSpy(...a), storage: {} }
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: () => SERVICE }))

const authz = { tutor: true, admin: false }
vi.mock('@/features/alta/lib/authz-tutor', () => ({
  esTutorLegalDe: () => Promise.resolve(authz.tutor),
  esAdminDeCentroDeNino: () => Promise.resolve(authz.admin),
}))

vi.mock('@/features/cambios-pendientes/lib/gate', () => ({
  altaValidada: () => Promise.resolve(false),
  registrarCambioPendiente: () => Promise.resolve({ ok: true }),
}))

const borrarSpy = vi.fn()
vi.mock('@/shared/lib/adjuntos/storage', () => ({
  BUCKET_LIBRO_FAMILIA: 'libro-familia',
  borrarObjetosBucket: (...a: unknown[]) => {
    borrarSpy(...a)
    return Promise.resolve()
  },
  firmarRuta: () => Promise.resolve('https://firmada'),
}))

import { POST } from '@/app/[locale]/alta/[ninoId]/libro-familia/route'

function makeFake(rpc: { data: string | null; error: { code?: string; message: string } | null }) {
  const rpcSpy = vi.fn()
  const b = {
    select: () => b,
    eq: () => b,
    is: () => b,
    maybeSingle: () => Promise.resolve({ data: { id: NINO, centro_id: CENTRO } }),
  }
  const fake = {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: USER } } }) },
    from: () => b,
    storage: { from: () => ({ upload: () => Promise.resolve({ error: null }) }) },
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcSpy(fn, args)
      return Promise.resolve(rpc)
    },
  }
  return { fake, rpcSpy }
}

function peticion(): Request {
  const form = new FormData()
  form.append('file', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'libro.pdf')
  return new Request('http://localhost/es/alta/x/libro-familia', { method: 'POST', body: form })
}

const params = { params: Promise.resolve({ ninoId: NINO }) }

beforeEach(() => {
  vi.clearAllMocks()
  authz.tutor = true
  authz.admin = false
})

describe('POST libro-familia — fija la ruta por RPC de sesión (D2)', () => {
  it('tutor legal: RPC con la ruta {centro}/{niño}/<uuid>.pdf y borra el libro anterior', async () => {
    const { fake, rpcSpy } = makeFake({ data: ANTERIOR, error: null })
    createClientMock.mockReturnValue(fake)

    const res = await POST(peticion(), params)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(rpcSpy).toHaveBeenCalledTimes(1)
    const [fn, args] = rpcSpy.mock.calls[0]!
    expect(fn).toBe('fijar_libro_familia_nino')
    expect(args.p_nino_id).toBe(NINO)
    expect(args.p_path).toMatch(new RegExp(`^${CENTRO}/${NINO}/[0-9a-f-]+\\.pdf$`))
    expect(borrarSpy).toHaveBeenCalledWith(SERVICE, 'libro-familia', [ANTERIOR])
    expect(serviceFromSpy).not.toHaveBeenCalled()
  })

  it('sin libro anterior: no borra nada', async () => {
    const { fake } = makeFake({ data: null, error: null })
    createClientMock.mockReturnValue(fake)

    const res = await POST(peticion(), params)

    expect(res.status).toBe(200)
    expect(borrarSpy).not.toHaveBeenCalled()
    expect(serviceFromSpy).not.toHaveBeenCalled()
  })

  it('42501 de la RPC → 403 y limpia el objeto recién subido', async () => {
    const { fake, rpcSpy } = makeFake({ data: null, error: { code: '42501', message: 'No' } })
    createClientMock.mockReturnValue(fake)

    const res = await POST(peticion(), params)

    expect(res.status).toBe(403)
    const subido = rpcSpy.mock.calls[0]![1].p_path
    expect(borrarSpy).toHaveBeenCalledWith(SERVICE, 'libro-familia', [subido])
    expect(serviceFromSpy).not.toHaveBeenCalled()
  })

  it('ruta rechazada por el backstop (23514) → 500 y limpia el objeto subido', async () => {
    const { fake, rpcSpy } = makeFake({ data: null, error: { code: '23514', message: 'ruta' } })
    createClientMock.mockReturnValue(fake)

    const res = await POST(peticion(), params)

    expect(res.status).toBe(500)
    expect(borrarSpy).toHaveBeenCalledWith(SERVICE, 'libro-familia', [
      rpcSpy.mock.calls[0]![1].p_path,
    ])
  })

  it('ni tutor legal ni admin → 403 sin RPC', async () => {
    authz.tutor = false
    const { fake, rpcSpy } = makeFake({ data: null, error: null })
    createClientMock.mockReturnValue(fake)

    const res = await POST(peticion(), params)

    expect(res.status).toBe(403)
    expect(rpcSpy).not.toHaveBeenCalled()
  })
})
