import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * R2 (multi-centro) — `sendInvitation` exige que el niño y el aula de la invitación sean del
 * centro objetivo. Un admin del centro A no puede atar una invitación a un niño o un aula del
 * centro B: `forbidden`, sin crear/actualizar la invitación y sin mandar el correo.
 */

const ADMIN = '11111111-1111-4111-8111-111111111111'
const CENTRO = '33333333-3333-4333-8333-333333333333'
const NINO = '22222222-2222-4222-8222-222222222222'
const AULA = '55555555-5555-4555-8555-555555555555'

/** ids de niños/aulas que SÍ son de CENTRO (el resto, de otro centro). */
let delCentro: Set<string>
let escrituras: number
let filtrosCentro: { tabla: string; centro: unknown }[]
const inviteUserByEmail = vi.fn(async () => ({ error: null }))

function serviceFake() {
  return {
    from: (tabla: string) => {
      const st = { id: null as unknown, centro: null as unknown, escritura: false }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {}
      b.select = () => b
      b.eq = (col: string, val: unknown) => {
        if (col === 'id') st.id = val
        if (col === 'centro_id') {
          st.centro = val
          filtrosCentro.push({ tabla, centro: val })
        }
        return b
      }
      b.is = () => b
      b.limit = () => b
      b.maybeSingle = () => b
      b.single = () => b
      b.insert = () => {
        st.escritura = true
        escrituras++
        return b
      }
      b.update = () => {
        st.escritura = true
        escrituras++
        return b
      }
      b.then = (resolve: (v: unknown) => unknown) => {
        if (tabla === 'ninos' || tabla === 'aulas') {
          const ok = st.centro === CENTRO && delCentro.has(String(st.id))
          return resolve({ data: ok ? { id: st.id } : null, error: null })
        }
        if (tabla === 'centros') return resolve({ data: { nombre: 'Escuela Demo' }, error: null })
        if (st.escritura) return resolve({ data: { id: 'inv', token: 'tok' }, error: null })
        // dedupe (sin invitación abierta) y lookup del token
        return resolve({ data: tabla === 'invitaciones' ? { token: 'tok' } : null, error: null })
      }
      return b
    },
    auth: { admin: { inviteUserByEmail } },
  }
}

// El idioma del correo lo resuelve `prepararIdiomaInvitacion` (lee la cuenta provisional por
// RPC); aquí se simula: devuelve el elegido o castellano.
vi.mock('@/features/auth/lib/idioma-invitacion', () => ({
  prepararIdiomaInvitacion: async (_s: unknown, _e: string, elegido?: string) => elegido ?? 'es',
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: ADMIN } } }) },
    from: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {}
      b.select = () => b
      b.eq = () => b
      b.is = () => b
      b.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: [{ rol: 'admin', centro_id: CENTRO }], error: null })
      return b
    },
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: () => serviceFake() }))

const { sendInvitation } = await import('../actions/send-invitation')

beforeEach(() => {
  vi.clearAllMocks()
  delCentro = new Set()
  escrituras = 0
  filtrosCentro = []
})

describe('R2 — sendInvitation: niño y aula del centro objetivo', () => {
  it('tutor con niño de OTRO centro → forbidden, sin escribir ni mandar correo', async () => {
    const r = await sendInvitation({
      email: 'tutor@nido.test',
      rolObjetivo: 'tutor_legal',
      centroId: CENTRO,
      ninoId: NINO, // no está en delCentro
    })
    expect(r).toEqual({ success: false, error: 'auth.invitation.errors.forbidden' })
    expect(escrituras).toBe(0)
    expect(inviteUserByEmail).not.toHaveBeenCalled()
    expect(filtrosCentro).toContainEqual({ tabla: 'ninos', centro: CENTRO })
  })

  it('profe con aula de OTRO centro → forbidden, sin escribir ni mandar correo', async () => {
    const r = await sendInvitation({
      email: 'profe@nido.test',
      rolObjetivo: 'profe',
      centroId: CENTRO,
      aulaId: AULA, // no está en delCentro
    })
    expect(r).toEqual({ success: false, error: 'auth.invitation.errors.forbidden' })
    expect(escrituras).toBe(0)
    expect(inviteUserByEmail).not.toHaveBeenCalled()
    expect(filtrosCentro).toContainEqual({ tabla: 'aulas', centro: CENTRO })
  })

  it('niño del MISMO centro → crea la invitación y manda el correo', async () => {
    delCentro.add(NINO)
    const r = await sendInvitation({
      email: 'tutor@nido.test',
      rolObjetivo: 'tutor_legal',
      centroId: CENTRO,
      ninoId: NINO,
    })
    expect(r.success).toBe(true)
    expect(escrituras).toBe(1)
    expect(inviteUserByEmail).toHaveBeenCalledOnce()
  })

  it('aula del MISMO centro → crea la invitación y manda el correo', async () => {
    delCentro.add(AULA)
    const r = await sendInvitation({
      email: 'profe@nido.test',
      rolObjetivo: 'profe',
      centroId: CENTRO,
      aulaId: AULA,
    })
    expect(r.success).toBe(true)
    expect(inviteUserByEmail).toHaveBeenCalledOnce()
  })

  it('admin sin niño ni aula → no comprueba nada extra y sigue igual', async () => {
    const r = await sendInvitation({
      email: 'admin@nido.test',
      rolObjetivo: 'admin',
      centroId: CENTRO,
    })
    expect(r.success).toBe(true)
    expect(filtrosCentro.filter((f) => f.tabla === 'ninos' || f.tabla === 'aulas')).toEqual([])
  })
})
