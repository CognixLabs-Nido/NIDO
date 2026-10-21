import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `sendInvitation` a una profe que está de baja temporal en el centro: no se crea la invitación,
 * y quien invita lee que la reactive desde Personal. Es un aviso para Dirección; la puerta es la
 * aceptación, que lo vuelve a mirar. Lo decide la tabla de motivos de la BD
 * (`dar_rol_de_invitacion` sin escribir), aquí simulada.
 */

const ADMIN = '11111111-1111-4111-8111-111111111111'
const CENTRO = '33333333-3333-4333-8333-333333333333'
const CUENTA = '66666666-6666-4666-8666-666666666666'
const AULA = '55555555-5555-4555-8555-555555555555'
const NINO = '22222222-2222-4222-8222-222222222222'

let cuentas: Array<{ id: string; email: string }>
let respuestaRol: { data: unknown; error: unknown }
let rpcs: Array<{ nombre: string; args: Record<string, unknown> }>
let escrituras: number
const inviteUserByEmail = vi.fn(async () => ({ error: null }))

function serviceFake() {
  return {
    rpc: async (nombre: string, args: Record<string, unknown>) => {
      rpcs.push({ nombre, args })
      if (nombre === 'buscar_auth_user_por_email') return { data: cuentas, error: null }
      if (nombre === 'dar_rol_de_invitacion') return respuestaRol
      return { data: false, error: null }
    },
    from: (tabla: string) => {
      const st = { escritura: false }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {}
      b.select = () => b
      b.eq = () => b
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
        if (tabla === 'centros') return resolve({ data: { nombre: 'Escuela Demo' }, error: null })
        // El aula y el niño de la invitación son del centro.
        if (tabla === 'aulas' || tabla === 'ninos')
          return resolve({ data: { id: 'x' }, error: null })
        if (st.escritura) return resolve({ data: { id: 'inv', token: 'tok' }, error: null })
        return resolve({ data: tabla === 'invitaciones' ? { token: 'tok' } : null, error: null })
      }
      return b
    },
    auth: { admin: { inviteUserByEmail } },
  }
}

vi.mock('@/features/auth/lib/idioma-invitacion', () => ({
  prepararIdiomaInvitacion: async (_s: unknown, _e: string, elegido?: string) => elegido ?? 'es',
}))

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

const noVuelve = (motivo: string) => ({
  data: null,
  error: { code: '55000', message: `retirada por ${motivo}`, hint: motivo },
})

const comprobaciones = () => rpcs.filter((r) => r.nombre === 'dar_rol_de_invitacion')

beforeEach(() => {
  vi.clearAllMocks()
  cuentas = [{ id: CUENTA, email: 'profe@nido.test' }]
  respuestaRol = { data: 'viva', error: null }
  rpcs = []
  escrituras = 0
})

describe('sendInvitation — una profe de baja temporal', () => {
  it('no se invita: Dirección lee que la reactive desde Personal, sin escribir ni correo', async () => {
    respuestaRol = noVuelve('baja_temporal')
    const r = await sendInvitation({
      email: 'profe@nido.test',
      rolObjetivo: 'profe',
      centroId: CENTRO,
      aulaId: AULA,
    })
    expect(comprobaciones()).toEqual([
      {
        nombre: 'dar_rol_de_invitacion',
        args: { p_usuario_id: CUENTA, p_centro_id: CENTRO, p_rol: 'profe', p_solo_comprobar: true },
      },
    ])
    expect(r).toEqual({ success: false, error: 'auth.invitation.errors.de_baja_temporal' })
    expect(escrituras).toBe(0)
    expect(inviteUserByEmail).not.toHaveBeenCalled()
  })

  it('con otro motivo (el olvido) se invita: eso lo dice la aceptación a la persona', async () => {
    respuestaRol = noVuelve('solicitud_olvido')
    const r = await sendInvitation({
      email: 'profe@nido.test',
      rolObjetivo: 'profe',
      centroId: CENTRO,
      aulaId: AULA,
    })
    expect(comprobaciones()).toHaveLength(1)
    expect(r.success).toBe(true)
    expect(escrituras).toBe(1)
  })

  it('sin cuenta con ese email, no hay nada que comprobar: se invita', async () => {
    cuentas = []
    const r = await sendInvitation({
      email: 'profe@nido.test',
      rolObjetivo: 'profe',
      centroId: CENTRO,
      aulaId: AULA,
    })
    expect(comprobaciones()).toEqual([])
    expect(r.success).toBe(true)
  })

  it('a otro rol no se le mira: la baja temporal es del personal', async () => {
    respuestaRol = noVuelve('baja_temporal')
    const r = await sendInvitation({
      email: 'profe@nido.test',
      rolObjetivo: 'autorizado',
      centroId: CENTRO,
      ninoId: NINO,
    })
    expect(comprobaciones()).toEqual([])
    expect(r.success).toBe(true)
  })
})
