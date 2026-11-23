import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { propsDe, type SesionConFallos } from './lectura-fallida'
import {
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearFamiliaTutor,
  crearVinculo,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * El SEPA silencioso del alta (C, 2026-11-23; descrito el 2026-11-12). La página del alta lee el
 * centro para el paso de la domiciliación: con su CID, el asistente monta el paso `sepa`; sin él, no.
 * Si esa LECTURA falla, `centro` es null y `centroTieneCid` sale false: el asistente se monta sin el
 * paso, como si el centro no domiciliara. El alta se cierra bien por las reglas (el SEPA es opcional,
 * D10), pero a la familia nunca se le ofrece y no ve ningún error: un fallo leído como REGLA.
 *
 * La PÁGINA real con la sesión real del tutor legal; lo que se afirma es lo que le llega al asistente.
 */
const sesion = vi.hoisted(
  (): SesionConFallos => ({ actual: null, fallaTabla: null, fallaRpc: null, fallidas: 0 })
)
vi.mock('@/lib/supabase/server', async () => {
  const { clienteConFallos } = await import('./lectura-fallida')
  return { createClient: async () => clienteConFallos(sesion) }
})
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
  redirect: (u: string) => {
    throw new Error(`REDIRECT ${u}`)
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/es/alta',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next-intl/server', () => ({
  getTranslations: async () =>
    Object.assign((k: string) => k, {
      has: () => true,
      rich: (k: string) => k,
      raw: (k: string) => k,
    }),
}))
vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign((k: string) => k, { has: () => true }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { default: AltaTutorPage } = await import('@/app/[locale]/alta/[ninoId]/page')
const { AltaTutorWizard } = await import('@/features/alta/components/AltaTutorWizard')
const { pasosAlta } = await import('@/features/alta/lib/estado-alta')
type PropsAsistente = Parameters<typeof AltaTutorWizard>[0]

const CID = 'ES81ZZZB00000000'

describe('el alta no calla el SEPA cuando no pudo leer el centro', () => {
  let nino: { id: string; familia_id: string }
  let legal: TestUser

  beforeAll(async () => {
    const centro = await createTestCentro('Centro Alta Sepa No Calla')
    const c = await serviceClient
      .from('centros')
      .update({ identificador_acreedor: CID, direccion: 'Calle del Centro 2, Valencia' })
      .eq('id', centro.id)
    if (c.error) throw new Error(`CID: ${c.error.message}`)
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id, 'Nino Alta Sepa No Calla')
    const matricula = await matricular(nino.id, aula.id, curso.id)
    legal = await createTestUser({ nombre: 'Legal Alta Sepa No Calla' })
    await crearFamiliaTutor(nino.familia_id, legal.id)
    await crearVinculo(nino.id, legal.id, 'tutor_legal_principal', { puede_ver_info_medica: true })
    const m = await serviceClient
      .from('matriculas')
      .update({ estado: 'pendiente' })
      .eq('id', matricula)
    if (m.error) throw new Error(`matrícula: ${m.error.message}`)
    sesion.actual = await clientFor(legal)
  })

  afterAll(async () => {
    sesion.actual = null
    if (legal) await deleteTestUser(legal.id)
  })

  afterEach(() => {
    sesion.fallaTabla = null
  })

  async function pagina(falla: boolean): Promise<unknown> {
    sesion.fallaTabla = falla ? 'centros' : null
    sesion.fallidas = 0
    try {
      return await AltaTutorPage({
        params: Promise.resolve({ locale: 'es', ninoId: nino.id }),
        searchParams: Promise.resolve({}),
      })
    } catch (e) {
      return e
    }
  }

  it('control: con el centro leído, el asistente lleva el paso sepa', async () => {
    const p = propsDe<PropsAsistente>(await pagina(false), AltaTutorWizard)
    expect(p, 'premisa: la página monta el asistente').not.toBeNull()
    expect(p!.centroTieneCid).toBe(true)
    expect(pasosAlta(p!.centroTieneCid, p!.centroTieneServicios, p!.cursoTieneGastos)).toContain(
      'sepa'
    )
  })

  it('si falla la lectura del centro, no se monta el alta como si el centro no domiciliara', async () => {
    const arbol = await pagina(true)
    expect(sesion.fallidas, 'premisa: la lectura del centro falló').toBeGreaterThan(0)
    const p = arbol instanceof Error ? null : propsDe<PropsAsistente>(arbol, AltaTutorWizard)
    if (p) {
      // Monta el asistente: entonces tiene que llevar el paso, porque el centro SÍ tiene CID.
      expect(p.centroTieneCid, 'el centro tiene CID').toBe(true)
    } else {
      expect(arbol, 'no monta el alta: lo dice').toBeInstanceOf(Error)
    }
  })
})
