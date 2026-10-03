import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * R3 (multi-centro) — `publicarAnuncio` comprueba que el aula es del centro actual ANTES de
 * insertar. Un admin del centro A no publica en un aula del centro B: `no_autorizado`, sin
 * insertar y sin push. El caso normal (aula propia, o ámbito centro) sigue igual.
 */

const USER = '11111111-1111-4111-8111-111111111111'
const CENTRO = '33333333-3333-4333-8333-333333333333'
const AULA_PROPIA = '55555555-5555-4555-8555-555555555555'
const AULA_AJENA = '66666666-6666-4666-8666-666666666666'

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
vi.mock('@/features/centros/queries/get-centro-actual', () => ({
  getCentroActualId: async () => CENTRO,
  getRolEnCentro: async () => 'admin',
}))
vi.mock('@/features/push/lib/audiencia', () => ({
  destinatariosPushDeAnuncio,
  getAutorPushInfo: async () => ({ idioma: 'es' }),
}))
vi.mock('@/features/push/lib/enviar-push', () => ({ enviarPushANotificarUsuarios: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))

const { publicarAnuncio } = await import('../publicar-anuncio')

const base = { titulo: 'Excursión', contenido: 'Mañana salimos al parque.' }

beforeEach(() => {
  vi.clearAllMocks()
  inserts = []
})

describe('R3 — publicarAnuncio: aula del centro actual', () => {
  it('admin con aula de OTRO centro → no_autorizado, sin insertar ni push', async () => {
    const r = await publicarAnuncio({ ...base, ambito: 'aula', aula_id: AULA_AJENA })
    expect(r).toEqual({ success: false, error: 'messages.errors.no_autorizado' })
    expect(inserts).toEqual([])
    expect(destinatariosPushDeAnuncio).not.toHaveBeenCalled()
  })

  it('aula del centro actual → inserta con ese centro', async () => {
    const r = await publicarAnuncio({ ...base, ambito: 'aula', aula_id: AULA_PROPIA })
    expect(r.success).toBe(true)
    expect(inserts[0]).toMatchObject({ centro_id: CENTRO, ambito: 'aula', aula_id: AULA_PROPIA })
  })

  it('ámbito centro (sin aula) → inserta sin comprobar aula', async () => {
    const r = await publicarAnuncio({ ...base, ambito: 'centro', aula_id: null })
    expect(r.success).toBe(true)
    expect(inserts[0]).toMatchObject({ centro_id: CENTRO, ambito: 'centro', aula_id: null })
  })
})
