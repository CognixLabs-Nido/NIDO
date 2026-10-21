import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * PR 1 (Fase 4) — D4 y hueco 3. Con una cuenta que ya existe, GoTrue no manda nada
 * (`email_exists`). Antes, `sendInvitation` contestaba «este email ya tiene una cuenta» (el
 * oráculo) y la persona no se enteraba. Ahora le llega el aviso por Resend y quien invita ve lo
 * mismo que con un email sin cuenta: «enviada» o «no se pudo enviar».
 */

const ADMIN = '11111111-1111-4111-8111-111111111111'
const CENTRO = '33333333-3333-4333-8333-333333333333'

let errorGoTrue: { code?: string; status?: number; message: string } | null
let avisoSale: boolean
const aviso = vi.fn(async () => avisoSale)

function serviceFake() {
  return {
    rpc: async () => ({ data: false, error: null }),
    from: (tabla: string) => {
      const st = { escritura: false, unica: false }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {}
      for (const m of ['select', 'eq', 'is', 'limit', 'maybeSingle']) b[m] = () => b
      b.single = () => {
        st.unica = true
        return b
      }
      b.insert = () => {
        st.escritura = true
        return b
      }
      b.then = (resolve: (v: unknown) => unknown) => {
        if (tabla === 'centros') return resolve({ data: { nombre: 'Escuela Demo' }, error: null })
        if (st.escritura) return resolve({ data: { id: 'inv-1', token: 'tok' }, error: null })
        // El token tras insertar (`.single()`); la búsqueda de duplicados no encuentra ninguna.
        if (tabla === 'invitaciones' && st.unica)
          return resolve({ data: { token: 'tok' }, error: null })
        return resolve({ data: null, error: null })
      }
      return b
    },
    auth: { admin: { inviteUserByEmail: async () => ({ data: null, error: errorGoTrue }) } },
  }
}

vi.mock('@/features/auth/lib/idioma-invitacion', () => ({
  prepararIdiomaInvitacion: async () => 'es',
}))
vi.mock('@/features/auth/lib/aviso-invitacion', () => ({ enviarAvisoInvitacion: aviso }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: ADMIN } } }) },
    rpc: async () => ({ data: false, error: null }),
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

const INVITACION = {
  email: 'persona@nido.test',
  rolObjetivo: 'directora' as const,
  centroId: CENTRO,
}

beforeEach(() => {
  aviso.mockClear()
  errorGoTrue = null
  avisoSale = true
})

describe('sendInvitation — cuenta que ya existe', () => {
  it('email sin cuenta: lo manda GoTrue; no hay aviso', async () => {
    const r = await sendInvitation(INVITACION)
    expect(r.success).toBe(true)
    expect(aviso).not.toHaveBeenCalled()
  })

  it('cuenta que ya existe: le llega el aviso, y quien invita ve «enviada» igual', async () => {
    errorGoTrue = { code: 'email_exists', status: 422, message: 'already registered' }

    const r = await sendInvitation(INVITACION)

    expect(r.success).toBe(true)
    expect(aviso).toHaveBeenCalledWith(expect.anything(), {
      email: 'persona@nido.test',
      centroNombre: 'Escuela Demo',
    })
  })

  it('el aviso no sale: el mismo error que cualquier correo que no sale, nunca «ya tiene cuenta»', async () => {
    errorGoTrue = { code: 'email_exists', status: 422, message: 'already registered' }
    avisoSale = false

    expect(await sendInvitation(INVITACION)).toEqual({
      success: false,
      error: 'auth.invitation.errors.email_no_enviado',
    })
  })

  it('otro fallo de GoTrue: no se intenta el aviso', async () => {
    errorGoTrue = { status: 500, message: 'smtp' }

    expect(await sendInvitation(INVITACION)).toEqual({
      success: false,
      error: 'auth.invitation.errors.email_no_enviado',
    })
    expect(aviso).not.toHaveBeenCalled()
  })
})
