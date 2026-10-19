import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * R3 (multi-centro) — `publicarAnuncio` recibe el centro de la página y comprueba que el aula es
 * de ese centro ANTES de insertar. Un admin del centro A no publica en un aula del centro B:
 * `no_autorizado`, sin insertar y sin push. El rol es el del usuario EN ese centro (Fase 1, PR5):
 * quien es admin en otro centro y profe en este no publica un anuncio de centro aquí.
 */

const USER = '11111111-1111-4111-8111-111111111111'
const CENTRO = '33333333-3333-4333-8333-333333333333'
const AULA_PROPIA = '55555555-5555-4555-8555-555555555555'
const AULA_AJENA = '66666666-6666-4666-8666-666666666666'
// Va antes que CENTRO por id: un «primer centro» lo cogería a él.
const OTRO_CENTRO = '22222222-2222-4222-8222-222222222222'

// Filas de roles_usuario del usuario, con la forma que lee `leerCentrosDe`.
let roles: { centro_id: string; rol: string }[]

let inserts: unknown[]
const destinatariosPushDeAnuncio = vi.fn(async () => [] as string[])

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    from: (tabla: string) => {
      const st = { id: null as unknown, centro: null as unknown, insert: null as unknown }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {}
      b.select = () => b
      b.is = () => b
      b.eq = (col: string, val: unknown) => {
        if (col === 'id') st.id = val
        if (col === 'centro_id') st.centro = val
        return b
      }
      b.maybeSingle = () => b
      b.single = () => b
      b.insert = (row: unknown) => {
        st.insert = row
        inserts.push(row)
        return b
      }
      b.then = (resolve: (v: unknown) => unknown) => {
        if (tabla === 'roles_usuario') return resolve({ data: roles, error: null })
        if (tabla === 'aulas') {
          const ok = st.id === AULA_PROPIA && st.centro === CENTRO
          return resolve({ data: ok ? { id: st.id } : null, error: null })
        }
        return resolve({ data: { id: 'anuncio-1' }, error: null })
      }
      return b
    },
  }),
}))
vi.mock('@/features/push/lib/audiencia', () => ({
  destinatariosPushDeAnuncio,
  getAutorPushInfo: async () => ({ idioma: 'es' }),
}))
vi.mock('@/features/push/lib/enviar-push', () => ({ enviarPushANotificarUsuarios: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))

const { publicarAnuncio } = await import('../publicar-anuncio')
const { enviarPushANotificarUsuarios } = await import('@/features/push/lib/enviar-push')

const base = { titulo: 'Excursión', contenido: 'Mañana salimos al parque.' }

beforeEach(() => {
  vi.clearAllMocks()
  inserts = []
  roles = [{ centro_id: CENTRO, rol: 'admin' }]
})

describe('R3 — publicarAnuncio: aula del centro de la página', () => {
  it('admin con aula de OTRO centro → no_autorizado, sin insertar ni push', async () => {
    const r = await publicarAnuncio({ ...base, ambito: 'aula', aula_id: AULA_AJENA }, CENTRO)
    expect(r).toEqual({ success: false, error: 'messages.errors.no_autorizado' })
    expect(inserts).toEqual([])
    expect(destinatariosPushDeAnuncio).not.toHaveBeenCalled()
  })

  it('aula del centro de la página → inserta con ese centro', async () => {
    const r = await publicarAnuncio({ ...base, ambito: 'aula', aula_id: AULA_PROPIA }, CENTRO)
    expect(r.success).toBe(true)
    expect(inserts[0]).toMatchObject({ centro_id: CENTRO, ambito: 'aula', aula_id: AULA_PROPIA })
  })

  it('ámbito centro (sin aula) → inserta sin comprobar aula', async () => {
    const r = await publicarAnuncio({ ...base, ambito: 'centro', aula_id: null }, CENTRO)
    expect(r.success).toBe(true)
    expect(inserts[0]).toMatchObject({ centro_id: CENTRO, ambito: 'centro', aula_id: null })
  })

  it('rol del centro de la página: admin en otro centro y profe aquí → no publica de centro', async () => {
    roles = [
      { centro_id: OTRO_CENTRO, rol: 'admin' },
      { centro_id: CENTRO, rol: 'profe' },
    ]
    // Premisa: el centro donde es admin va primero por id.
    expect(OTRO_CENTRO < CENTRO).toBe(true)
    const r = await publicarAnuncio({ ...base, ambito: 'centro', aula_id: null }, CENTRO)
    expect(r).toEqual({ success: false, error: 'messages.errors.no_autorizado' })
    expect(inserts).toEqual([])
  })

  it('sin rol en el centro de la página → no_autorizado, aunque sea admin en otro', async () => {
    roles = [{ centro_id: OTRO_CENTRO, rol: 'admin' }]
    const r = await publicarAnuncio({ ...base, ambito: 'centro', aula_id: null }, CENTRO)
    expect(r).toEqual({ success: false, error: 'messages.errors.no_autorizado' })
    expect(inserts).toEqual([])
  })

  it('la notificación abre el anuncio y lleva el centro de la página (multicentro)', async () => {
    destinatariosPushDeAnuncio.mockResolvedValueOnce(['tutor-1'])
    const r = await publicarAnuncio({ ...base, ambito: 'centro', aula_id: null }, CENTRO)
    expect(r.success).toBe(true)
    expect(enviarPushANotificarUsuarios).toHaveBeenCalledWith(
      ['tutor-1'],
      expect.objectContaining({ url: `/es/messages/anuncios/anuncio-1?centro=${CENTRO}` })
    )
  })
})
