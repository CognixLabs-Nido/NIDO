import { beforeEach, describe, expect, it, vi } from 'vitest'

import { rutaDeLaPublicacion, rutasBorrables } from '../../lib/storage'

/**
 * R4 — al quitar una foto o borrar una publicación, la app solo borra en Storage (service
 * role) las rutas de ESA publicación: `{centro}/{aula}/{publicacion}/<nombre>.jpg`, con el
 * prefijo derivado de la publicación de la fila, nunca del input. Una ruta ajena metida en
 * `media.path` / `path_miniatura` no se borra. Storage va con un doble (nada real).
 */

const CENTRO = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
const AULA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const PUB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const MEDIA = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
const PREFIJO = `${CENTRO}/${AULA}/${PUB}`
const PROPIA = `${PREFIJO}/1b4e28ba-2fa1-11d2-883f-0016d3cca427.jpg`
const PROPIA_THUMB = `${PREFIJO}/1b4e28ba-2fa1-11d2-883f-0016d3cca427_thumb.jpg`

const OTRO_CENTRO = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
const OTRA_AULA = 'ffffffff-ffff-4fff-8fff-fffffffffff1'
const OTRA_PUB = '99999999-9999-4999-8999-999999999991'

/** Rutas ajenas a la publicación PUB que un redactor podría meter en una fila `media`. */
const RUTAS_AJENAS: [string, string][] = [
  ['otra publicación, misma aula', `${CENTRO}/${AULA}/${OTRA_PUB}/x.jpg`],
  ['otra aula', `${CENTRO}/${OTRA_AULA}/${PUB}/x.jpg`],
  ['otro centro', `${OTRO_CENTRO}/${AULA}/${PUB}/x.jpg`],
  ['escapa con ..', `${PREFIJO}/../${OTRA_PUB}/x.jpg`],
  ['subcarpeta', `${PREFIJO}/sub/x.jpg`],
  ['otro bucket-path sin prefijo', `logos/${CENTRO}.png`],
  ['prefijo sin barra', `${PREFIJO}x.jpg`],
  ['no es jpg', `${PREFIJO}/x.png`],
]

describe('rutaDeLaPublicacion / rutasBorrables', () => {
  it('acepta el original y la miniatura que construye rutasFotoNueva', () => {
    expect(rutaDeLaPublicacion(PROPIA, PREFIJO)).toBe(true)
    expect(rutaDeLaPublicacion(PROPIA_THUMB, PREFIJO)).toBe(true)
  })

  it.each(RUTAS_AJENAS)('rechaza una ruta ajena: %s', (_caso, ruta) => {
    expect(rutaDeLaPublicacion(ruta, PREFIJO)).toBe(false)
  })

  it('rutasBorrables separa propias de ajenas; sin prefijo no borra nada', () => {
    const medias = [{ path: PROPIA, path_miniatura: RUTAS_AJENAS[0]![1] }]
    expect(rutasBorrables(medias, PREFIJO)).toEqual({ rutas: [PROPIA], ajenas: 1 })
    expect(rutasBorrables(medias, null)).toEqual({ rutas: [], ajenas: 2 })
  })
})

// ── Acciones ────────────────────────────────────────────────────────────────

/** Cola de respuestas del cliente del usuario (cada await consume la siguiente). */
let respuestas: unknown[] = []
const remove = vi.fn(async () => ({ data: [], error: null }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'autor' } } }) },
    from: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {}
      for (const m of ['select', 'eq', 'delete', 'maybeSingle']) b[m] = () => b
      b.then = (resolve: (v: unknown) => unknown) => resolve(respuestas.shift())
      return b
    },
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({ storage: { from: () => ({ remove }) } }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { eliminarMedia, eliminarPublicacion } = await import('../gestionar-publicacion')

beforeEach(() => {
  vi.clearAllMocks()
  respuestas = []
})

describe('R4 — eliminarMedia', () => {
  const fila = (path: string, path_miniatura: string | null) => ({
    data: {
      path,
      path_miniatura,
      publicacion_id: PUB,
      publicaciones: { centro_id: CENTRO, aula_id: AULA },
    },
    error: null,
  })

  it('legítima: borra original + miniatura de su publicación', async () => {
    respuestas = [fila(PROPIA, PROPIA_THUMB), { error: null, count: 1 }]
    const r = await eliminarMedia({ media_id: MEDIA })
    expect(r.success).toBe(true)
    expect(remove).toHaveBeenCalledWith([PROPIA, PROPIA_THUMB])
  })

  it.each(RUTAS_AJENAS)(
    'miniatura ajena (%s): borra solo la propia, NUNCA la ajena',
    async (_caso, ajena) => {
      respuestas = [fila(PROPIA, ajena), { error: null, count: 1 }]
      const r = await eliminarMedia({ media_id: MEDIA })
      expect(r.success).toBe(true)
      expect(remove).toHaveBeenCalledWith([PROPIA])
      expect(remove.mock.calls.flat(2)).not.toContain(ajena)
    }
  )

  it('ambas rutas ajenas: no llama a Storage', async () => {
    respuestas = [fila(RUTAS_AJENAS[0]![1], RUTAS_AJENAS[2]![1]), { error: null, count: 1 }]
    await eliminarMedia({ media_id: MEDIA })
    expect(remove).not.toHaveBeenCalled()
  })

  it('el borrado de la fila no autorizado (count 0): no toca Storage', async () => {
    respuestas = [fila(PROPIA, PROPIA_THUMB), { error: null, count: 0 }]
    const r = await eliminarMedia({ media_id: MEDIA })
    expect(r.success).toBe(false)
    expect(remove).not.toHaveBeenCalled()
  })
})

describe('R4 — eliminarPublicacion', () => {
  const pub = { data: { centro_id: CENTRO, aula_id: AULA }, error: null }

  it('legítima: borra los objetos de todas sus medias', async () => {
    respuestas = [
      pub,
      { data: [{ path: PROPIA, path_miniatura: PROPIA_THUMB }], error: null },
      { error: null, count: 1 },
    ]
    const r = await eliminarPublicacion({ publicacion_id: PUB })
    expect(r.success).toBe(true)
    expect(remove).toHaveBeenCalledWith([PROPIA, PROPIA_THUMB])
  })

  it('una media con rutas ajenas: solo se borran las propias', async () => {
    const ajenas = RUTAS_AJENAS.map(([, r]) => r)
    respuestas = [
      pub,
      {
        data: [
          { path: PROPIA, path_miniatura: PROPIA_THUMB },
          { path: ajenas[0], path_miniatura: ajenas[1] },
          { path: ajenas[2], path_miniatura: ajenas[3] },
        ],
        error: null,
      },
      { error: null, count: 1 },
    ]
    await eliminarPublicacion({ publicacion_id: PUB })
    expect(remove).toHaveBeenCalledWith([PROPIA, PROPIA_THUMB])
  })

  it('publicación no resuelta (sin prefijo): no borra nada en Storage', async () => {
    respuestas = [
      { data: null, error: null },
      { data: [{ path: PROPIA, path_miniatura: PROPIA_THUMB }], error: null },
      { error: null, count: 1 },
    ]
    await eliminarPublicacion({ publicacion_id: PUB })
    expect(remove).not.toHaveBeenCalled()
  })
})
