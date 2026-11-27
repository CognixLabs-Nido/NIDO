// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La subida de una foto con una lectura caída o con la limpieza a medias (censo C, B1, 2026-11-26):
 *  - sin leer la publicación contestaba 403 «no autorizado» (un motivo falso);
 *  - sin contar las fotos, `null` era 0 y el límite por publicación (P4) no se miraba;
 *  - si la subida fallaba, la limpieza (borrar la fila y los ficheros) se esperaba y se tiraba: una foto
 *    vacía en la publicación, o ficheros de niños sin fila, sin que nadie lo supiera.
 * Lo de Sharp no se prueba aquí: `procesarFoto` es de mentira. Fixtures ficticios.
 */
const { bd } = vi.hoisted(() => ({
  bd: {
    errPub: null as unknown,
    count: 0 as number | null,
    errCount: null as unknown,
    errSubida: null as unknown,
    errBorrarFila: null as unknown,
    errBorrarObjetos: null as unknown,
    escrituras: [] as string[],
  },
}))

vi.mock('@/shared/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))
vi.mock('@/features/fotos/lib/procesar-foto', () => ({
  FotoInvalidaError: class extends Error {
    clave = 'x'
  },
  procesarFoto: async () => ({
    original: Buffer.from('o'),
    miniatura: Buffer.from('m'),
    hash: 'h',
    ancho: 10,
    alto: 10,
    bytes: 1,
  }),
}))
vi.mock('@/features/fotos/lib/storage', () => ({
  prefijoPublicacion: () => 'c/a/p',
  rutasFotoNueva: () => ({ original: 'c/a/p/o.jpg', miniatura: 'c/a/p/m.jpg' }),
  firmarRutas: async () => new Map(),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    storage: {
      from: () => ({
        upload: async () => {
          bd.escrituras.push('sube')
          return { error: bd.errSubida }
        },
        remove: async () => {
          bd.escrituras.push('borra objetos')
          return { error: bd.errBorrarObjetos }
        },
      }),
    },
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    from: (tabla: string) => {
      const c: Record<string, unknown> = {}
      let op = 'select'
      c.select = (_c?: string, o?: { head?: boolean }) => {
        if (o?.head) return { eq: async () => ({ count: bd.count, error: bd.errCount }) }
        return c
      }
      c.eq = () =>
        op === 'delete'
          ? (bd.escrituras.push('borra fila'), Promise.resolve({ error: bd.errBorrarFila }))
          : c
      c.insert = () => ((op = 'insert'), bd.escrituras.push(`inserta ${tabla}`), c)
      c.delete = () => ((op = 'delete'), c)
      c.maybeSingle = async () =>
        op === 'insert'
          ? { data: { id: 'media-1' }, error: null }
          : bd.errPub
            ? { data: null, error: bd.errPub }
            : { data: { id: PUB, centro_id: 'c', aula_id: 'a' }, error: null }
      return c
    },
  }),
}))

const { POST } = await import('../route')
const PUB = '00000000-0000-4000-8000-000000000001'

async function subir() {
  const form = new FormData()
  form.append('publicacion_id', PUB)
  form.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), 'f.jpg')
  const res = await POST(new Request('http://x', { method: 'POST', body: form }))
  return { status: res.status, body: (await res.json()) as { success: boolean; error?: string } }
}

const CAIDA = { code: 'XX000', message: 'caída' }

beforeEach(() => {
  Object.assign(bd, {
    errPub: null,
    count: 0,
    errCount: null,
    errSubida: null,
    errBorrarFila: null,
    errBorrarObjetos: null,
    escrituras: [],
  })
})

describe('POST /fotos/upload', () => {
  it('premisa: con todo bien, guarda la fila y sube los dos ficheros', async () => {
    const r = await subir()
    expect(r.body).toEqual({ success: true, media: expect.anything() })
    expect(bd.escrituras).toEqual(['inserta media', 'sube', 'sube'])
  })

  it('sin leer la publicación: no dice «no autorizado», y no escribe', async () => {
    bd.errPub = CAIDA
    expect(await subir()).toEqual({
      status: 500,
      body: { success: false, error: 'common.lectura_fallida' },
    })
    expect(bd.escrituras).toEqual([])
  })

  it('sin contar las fotos: no se salta el límite, y no escribe', async () => {
    bd.errCount = CAIDA
    bd.count = null
    expect((await subir()).body).toEqual({ success: false, error: 'common.lectura_fallida' })
    expect(bd.escrituras).toEqual([])
  })

  it('premisa del límite: con las fotos contadas y en el tope, no sube', async () => {
    bd.count = 1_000
    expect((await subir()).body).toEqual({ success: false, error: 'fotos.validation.max_fotos' })
  })

  it('subida fallida con la limpieza bien: «no se pudo subir»', async () => {
    bd.errSubida = CAIDA
    expect((await subir()).body).toEqual({ success: false, error: 'fotos.errors.subida_fallo' })
    expect(bd.escrituras).toContain('borra fila')
  })

  it.each([
    ['la fila', 'errBorrarFila'],
    ['los ficheros', 'errBorrarObjetos'],
  ])('subida fallida y sin poder borrar %s: lo dice', async (_q, campo) => {
    bd.errSubida = CAIDA
    ;(bd as Record<string, unknown>)[campo] = CAIDA
    expect(await subir()).toEqual({
      status: 500,
      body: { success: false, error: 'fotos.errors.subida_a_medias' },
    })
  })
})
