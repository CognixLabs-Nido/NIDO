// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { esLecturaFallida } from '@/shared/lib/lectura-fallida'

/**
 * La página de la invitación con una lectura caída (censo C, B1, 2026-11-26): sin leer la invitación
 * mandaba a «enlace caducado» (un motivo falso), y sin leer el centro montaba el alta sin el paso de
 * domiciliación (sin CID). Ahora lanza `LecturaFallida` y la pinta `[locale]/error.tsx`.
 */
const { bd } = vi.hoisted(() => ({
  bd: { errInvitacion: null as unknown, errCentro: null as unknown, lecturas: [] as string[] },
}))

vi.mock('next/navigation', () => ({
  redirect: (u: string) => {
    throw new Error(`REDIRECT ${u}`)
  },
}))
vi.mock('@/features/auth/lib/detectar-cuenta-email', () => ({
  detectarCuentaPorEmail: async () => ({
    authUserExiste: false,
    tieneRoles: false,
    haOperado: false,
  }),
}))
vi.mock('@/features/peticion-servicios/queries/leer-peticion-servicios', () => ({
  centroOfreceServicios: async () => false,
}))
vi.mock('@/features/gastos-gestion/queries/leer-gastos-gestion', () => ({
  cursoDelAltaTieneGastos: async () => false,
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    from: (tabla: string) => {
      const c: Record<string, unknown> = {}
      c.select = () => c
      c.eq = () => c
      c.maybeSingle = async () => {
        bd.lecturas.push(tabla)
        if (tabla === 'invitaciones')
          return bd.errInvitacion
            ? { data: null, error: bd.errInvitacion }
            : {
                data: {
                  email: 'tutora@example.test',
                  rol_objetivo: 'tutor_legal',
                  nombre_completo: 'Tutora Demo',
                  nino_id: 'nino-1',
                  centro_id: 'centro-1',
                  expires_at: '2999-01-01T00:00:00Z',
                  accepted_at: null,
                  rejected_at: null,
                },
                error: null,
              }
        return bd.errCentro
          ? { data: null, error: bd.errCentro }
          : { data: { identificador_acreedor: 'ES00ZZZ00000000000' }, error: null }
      }
      return c
    },
  }),
}))

const { default: InvitationPage } = await import('../page')
const TOKEN = '00000000-0000-4000-8000-000000000001'
const CAIDA = { code: 'XX000', message: 'caída' }

async function pagina() {
  try {
    return await InvitationPage({ params: Promise.resolve({ locale: 'es', token: TOKEN }) })
  } catch (e) {
    return e
  }
}

beforeEach(() => {
  bd.errInvitacion = null
  bd.errCentro = null
  bd.lecturas = []
})

describe('la página de la invitación', () => {
  it('premisa: con todo leído, monta el alta con el paso de domiciliación', async () => {
    const r = (await pagina()) as { props?: { centroTieneCid?: boolean } }
    expect(r).not.toBeInstanceOf(Error)
    expect(r.props?.centroTieneCid).toBe(true)
  })

  it('sin leer la invitación: no manda a «caducada», lanza', async () => {
    bd.errInvitacion = CAIDA
    const e = await pagina()
    expect(esLecturaFallida(e), String(e)).toBe(true)
    expect((e as { donde: string }).donde).toBe('invitación')
  })

  it('sin leer el centro: no monta el alta sin domiciliación, lanza', async () => {
    bd.errCentro = CAIDA
    const e = await pagina()
    expect(bd.lecturas, 'premisa: llegó a leer el centro').toEqual(['invitaciones', 'centros'])
    expect(esLecturaFallida(e), String(e)).toBe(true)
    expect((e as { donde: string }).donde).toBe('invitación: centro')
  })
})
