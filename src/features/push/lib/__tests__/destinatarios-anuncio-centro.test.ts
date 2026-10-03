import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * R3 (multi-centro) — `destinatariosPushDeAnuncio` solo notifica a familias de aulas del centro
 * del anuncio. Con un aula de OTRO centro (que la BD ya no deja insertar), la audiencia es vacía:
 * los tutores de ese aula no reciben el push. El caso normal (aula propia) sigue igual.
 */

const CENTRO_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const AULA_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const AULA_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2' // aula del centro B
const TUTOR_A = 'tutor-a'
const TUTOR_B = 'tutor-b'

/** aula → centro (lo que hay en la tabla `aulas`). */
const CENTRO_DE_AULA: Record<string, string> = {
  [AULA_A]: CENTRO_A,
  [AULA_B]: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
}

const matricula = (aula_id: string) => ({
  aula_id,
  fecha_baja: null,
  deleted_at: null,
  estado: 'activa',
})
const VINCULOS = [
  {
    usuario_id: TUTOR_A,
    permisos: { puede_recibir_mensajes: true },
    nino: { matriculas: [matricula(AULA_A)] },
  },
  {
    usuario_id: TUTOR_B,
    permisos: { puede_recibir_mensajes: true },
    nino: { matriculas: [matricula(AULA_B)] },
  },
]

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    from: (tabla: string) => {
      const st = { id: null as unknown, centro: null as unknown }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {}
      b.select = () => b
      b.eq = (col: string, val: unknown) => {
        if (col === 'id') st.id = val
        if (col === 'centro_id') st.centro = val
        return b
      }
      b.is = () => b
      b.maybeSingle = () => b
      b.then = (resolve: (v: unknown) => unknown) => {
        if (tabla === 'aulas') {
          // Como la BD real: la fila existe por id; el filtro de centro (si lo hay) la acota.
          const existe = String(st.id) in CENTRO_DE_AULA
          const ok = existe && (st.centro === null || CENTRO_DE_AULA[String(st.id)] === st.centro)
          return resolve({ data: ok ? { id: st.id } : null, error: null })
        }
        if (tabla === 'vinculos_familiares') return resolve({ data: VINCULOS, error: null })
        return resolve({ data: null, error: null })
      }
      return b
    },
  }),
}))

const { destinatariosPushDeAnuncio } = await import('../audiencia')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('R3 — destinatariosPushDeAnuncio: solo aulas del centro del anuncio', () => {
  it('anuncio de A con aula de B → audiencia vacía (el tutor de B NO recibe push)', async () => {
    const r = await destinatariosPushDeAnuncio(
      { centro_id: CENTRO_A, ambito: 'aula', aula_id: AULA_B },
      'autor'
    )
    expect(r).toEqual([])
  })

  it('anuncio de A con aula de A → notifica a sus familias, nunca a las de B', async () => {
    const r = await destinatariosPushDeAnuncio(
      { centro_id: CENTRO_A, ambito: 'aula', aula_id: AULA_A },
      'autor'
    )
    expect(r).toEqual([TUTOR_A])
  })
})
