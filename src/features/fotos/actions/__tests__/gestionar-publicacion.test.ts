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

/** Cola de respuestas de las consultas del cliente del usuario (cada await consume la siguiente). */
let respuestas: unknown[] = []
/** Lo que pasa, en orden: `remove` (Storage) y `delete` (la fila). */
let pasos: string[] = []
/** Lo que contesta Storage al borrar, y lo que sigue en la carpeta al mirarlo después. */
let respuestaRemove: { data: unknown[]; error: { message: string } | null } = {
  data: [],
  error: null,
}
let siguen: string[] = []

// Un solo `remove` para la sesión y para el servicio: el test mide QUÉ se borra y CUÁNDO, no con
// qué cliente (con cuál lo decide la política de Storage, y eso lo mide el test RLS).
const remove = vi.fn(async (_rutas: string[]) => {
  pasos.push('remove')
  return respuestaRemove
})
const list = vi.fn(async () => ({ data: siguen.map((name) => ({ name })), error: null }))
const storage = { from: () => ({ remove, list }) }

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'autor' } } }) },
    storage,
    from: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {}
      for (const m of ['select', 'eq', 'maybeSingle']) b[m] = () => b
      b.delete = () => {
        pasos.push('delete')
        return b
      }
      b.then = (resolve: (v: unknown) => unknown) => resolve(respuestas.shift())
      return b
    },
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({ storage }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { eliminarMedia, eliminarPublicacion } = await import('../gestionar-publicacion')

beforeEach(() => {
  vi.clearAllMocks()
  respuestas = []
  pasos = []
  respuestaRemove = { data: [], error: null }
  siguen = []
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

/**
 * Censo C, grupo 1 (decisión de Jose del 2026-11-25): **primero el fichero, después la fila**. Si las
 * fotos no se borran, la fila se queda con su ruta (se puede reintentar) y la acción no contesta ok.
 * Antes: la fila se borraba primero, Storage se miraba sin leer su error, y una lectura fallida de
 * las rutas se tomaba por «no hay fotos». En los tres casos, ok y las fotos de los niños en el bucket.
 */
describe('las fotos del blog: primero el fichero, después la fila', () => {
  const pub = { data: { centro_id: CENTRO, aula_id: AULA }, error: null }
  const medias = { data: [{ path: PROPIA, path_miniatura: PROPIA_THUMB }], error: null }
  const media = {
    data: {
      path: PROPIA,
      path_miniatura: PROPIA_THUMB,
      publicacion_id: PUB,
      publicaciones: { centro_id: CENTRO, aula_id: AULA },
    },
    error: null,
  }
  const NO_BORRADAS = 'fotos.errors.fotos_no_borradas'

  it('publicación: Storage antes que la fila', async () => {
    respuestas = [pub, medias, { error: null, count: 1 }]
    const r = await eliminarPublicacion({ publicacion_id: PUB })
    expect(r.success, 'premisa: el caso legítimo sale bien').toBe(true)
    expect(pasos).toEqual(['remove', 'delete'])
  })

  it('una foto: Storage antes que la fila', async () => {
    respuestas = [media, { error: null, count: 1 }]
    const r = await eliminarMedia({ media_id: MEDIA })
    expect(r.success, 'premisa: el caso legítimo sale bien').toBe(true)
    expect(pasos).toEqual(['remove', 'delete'])
  })

  it('publicación: si Storage da error, la fila no se borra y no contesta ok', async () => {
    respuestas = [pub, medias, { error: null, count: 1 }]
    respuestaRemove = { data: [], error: { message: 'storage caído' } }
    const r = await eliminarPublicacion({ publicacion_id: PUB })
    expect(remove, 'premisa: se intentó borrar en Storage').toHaveBeenCalled()
    expect(r).toEqual({ success: false, error: NO_BORRADAS })
    expect(pasos).not.toContain('delete')
  })

  it('una foto: si Storage da error, la fila no se borra y no contesta ok', async () => {
    respuestas = [media, { error: null, count: 1 }]
    respuestaRemove = { data: [], error: { message: 'storage caído' } }
    const r = await eliminarMedia({ media_id: MEDIA })
    expect(remove, 'premisa: se intentó borrar en Storage').toHaveBeenCalled()
    expect(r).toEqual({ success: false, error: NO_BORRADAS })
    expect(pasos).not.toContain('delete')
  })

  it('publicación: Storage no da error pero la foto sigue (lo que hace al negar): la fila no se borra', async () => {
    respuestas = [pub, medias, { error: null, count: 1 }]
    siguen = [PROPIA.split('/').pop()!]
    const r = await eliminarPublicacion({ publicacion_id: PUB })
    expect(remove, 'premisa: se intentó borrar en Storage').toHaveBeenCalled()
    expect(r).toEqual({ success: false, error: NO_BORRADAS })
    expect(pasos).not.toContain('delete')
  })

  it('una foto: Storage no da error pero la foto sigue: la fila no se borra', async () => {
    respuestas = [media, { error: null, count: 1 }]
    siguen = [PROPIA_THUMB.split('/').pop()!]
    const r = await eliminarMedia({ media_id: MEDIA })
    expect(remove, 'premisa: se intentó borrar en Storage').toHaveBeenCalled()
    expect(r).toEqual({ success: false, error: NO_BORRADAS })
    expect(pasos).not.toContain('delete')
  })

  it('publicación: si la lectura de las fotos falla, no se borra nada', async () => {
    respuestas = [pub, { data: null, error: { message: 'timeout' } }, { error: null, count: 1 }]
    const r = await eliminarPublicacion({ publicacion_id: PUB })
    expect(r).toEqual({ success: false, error: 'fotos.errors.borrado_fallo' })
    expect(pasos).toEqual([])
  })

  it('una foto: si la lectura de la foto falla, no se borra nada', async () => {
    respuestas = [
      { data: null, error: { message: 'timeout' } },
      { error: null, count: 1 },
    ]
    const r = await eliminarMedia({ media_id: MEDIA })
    expect(r).toEqual({ success: false, error: 'fotos.errors.borrado_fallo' })
    expect(pasos).toEqual([])
  })
})
