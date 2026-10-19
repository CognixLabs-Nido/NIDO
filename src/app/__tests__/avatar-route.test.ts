// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Ruta del avatar de usuario con prefijo propio (`20261019120000`): la foto vive en
 * `usuarios-fotos/{usuarioId}/…`, sin centro en la ruta. Para el avatar de OTRO usuario se
 * pregunta antes a `es_admin_de_usuario`; la RLS de Storage sigue autorizando la subida.
 */

const YO = '11111111-1111-4111-8111-111111111111'
const OTRO = '22222222-2222-4222-8222-222222222222'

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClientMock() }))

const b = {
  select: () => b,
  update: () => b,
  eq: () => b,
  maybeSingle: () => Promise.resolve({ data: { foto_url: null } }),
  then: (r: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(r),
}
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: () => ({ from: () => b }) }))

vi.mock('@/shared/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))

vi.mock('@/features/fotos/lib/procesar-foto', () => ({
  FotoInvalidaError: class FotoInvalidaError extends Error {
    clave = 'x'
  },
}))
vi.mock('@/shared/lib/adjuntos/procesar-imagen', () => ({
  MAX_BYTES_ADJUNTO: 4 * 1024 * 1024,
  procesarFotoAvatar: () =>
    Promise.resolve({ original: Buffer.from('o'), miniatura: Buffer.from('m') }),
}))

const rutasSpy = vi.fn()
vi.mock('@/shared/lib/adjuntos/storage', () => ({
  BUCKET_USUARIOS_FOTOS: 'usuarios-fotos',
  borrarObjetosBucket: () => Promise.resolve(),
  firmarRutasBucket: () => Promise.resolve(new Map()),
  rutaThumbDe: (r: string) => r.replace(/\.jpg$/, '_thumb.jpg'),
  rutasConThumb: (prefijo: string) => {
    rutasSpy(prefijo)
    return { original: `${prefijo}/f.jpg`, miniatura: `${prefijo}/f_thumb.jpg` }
  },
}))

import { POST } from '@/app/[locale]/usuarios/[id]/avatar/route'

function makeFake(rpc: { data: boolean | null; error: { message: string } | null }) {
  const rpcSpy = vi.fn()
  const uploadSpy = vi.fn()
  const fake = {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: YO } } }) },
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcSpy(fn, args)
      return Promise.resolve(rpc)
    },
    storage: {
      from: () => ({
        upload: (path: string) => {
          uploadSpy(path)
          return Promise.resolve({ error: null })
        },
      }),
    },
  }
  return { fake, rpcSpy, uploadSpy }
}

function peticion(): Request {
  const form = new FormData()
  form.append('file', new Blob(['jpg'], { type: 'image/jpeg' }), 'a.jpg')
  return new Request('http://localhost/es/usuarios/x/avatar', { method: 'POST', body: form })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST usuarios/[id]/avatar — prefijo del dueño', () => {
  it('el propio usuario: sube bajo {usuarioId}/ y no pregunta a es_admin_de_usuario', async () => {
    const { fake, rpcSpy, uploadSpy } = makeFake({ data: false, error: null })
    createClientMock.mockReturnValue(fake)

    const res = await POST(peticion(), params(YO))

    expect(res.status).toBe(200)
    expect(rpcSpy).not.toHaveBeenCalled()
    expect(rutasSpy).toHaveBeenCalledWith(YO)
    expect(uploadSpy.mock.calls.map(([p]) => p)).toEqual([`${YO}/f.jpg`, `${YO}/f_thumb.jpg`])
  })

  it('admin de un centro del otro usuario: pregunta por ESE usuario y sube bajo su carpeta', async () => {
    const { fake, rpcSpy, uploadSpy } = makeFake({ data: true, error: null })
    createClientMock.mockReturnValue(fake)

    const res = await POST(peticion(), params(OTRO))

    expect(res.status).toBe(200)
    expect(rpcSpy).toHaveBeenCalledWith('es_admin_de_usuario', { p_usuario_id: OTRO })
    expect(rutasSpy).toHaveBeenCalledWith(OTRO)
    expect(uploadSpy.mock.calls.map(([p]) => p)).toEqual([`${OTRO}/f.jpg`, `${OTRO}/f_thumb.jpg`])
  })

  it('sin permiso sobre el otro usuario: 403 y no sube nada', async () => {
    const { fake, rpcSpy, uploadSpy } = makeFake({ data: false, error: null })
    createClientMock.mockReturnValue(fake)

    const res = await POST(peticion(), params(OTRO))

    expect(rpcSpy).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('fotos.errors.no_autorizado')
    expect(uploadSpy).not.toHaveBeenCalled()
  })

  it('si la comprobación falla, es un fallo (500), no «no autorizado»', async () => {
    const { fake, rpcSpy, uploadSpy } = makeFake({ data: null, error: { message: 'boom' } })
    createClientMock.mockReturnValue(fake)

    const res = await POST(peticion(), params(OTRO))

    expect(rpcSpy).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('fotos.errors.subida_fallo')
    expect(uploadSpy).not.toHaveBeenCalled()
  })
})
