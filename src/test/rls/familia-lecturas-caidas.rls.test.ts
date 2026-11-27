import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { esLecturaFallida } from '@/shared/lib/lectura-fallida'

import { propsDe, type SesionConFallos } from './lectura-fallida'
import {
  asignarRol,
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
  type TestUser,
} from './setup'

/**
 * Dos páginas de la familia con una lectura caída (censo C, B1, 2026-11-26):
 *  - la ficha del niño leía el vínculo sin mirar el error: sin permisos y sin ser tutor legal, escondía lo
 *    que la familia sí puede ver (y no le ofrecía la firma de la ficha);
 *  - los recibos leían el centro igual: sin CID, no ofrecían domiciliar, como si el centro no domiciliara.
 * Ahora lanzan `LecturaFallida` y las pinta `family/error.tsx`.
 *
 * La misma tabla se lee varias veces (el ámbito de la familia lee los vínculos antes): se tumba cada
 * lectura por turno (`fallaSoloLaN`) y se exige que UNA de ellas pare en ESTE sitio, por su `donde`. Sin la
 * comprobación, ninguna para ahí. La PÁGINA real con la sesión real del tutor legal. Fixtures ficticios.
 */
const sesion = vi.hoisted(
  (): SesionConFallos => ({ actual: null, fallaTabla: null, fallaRpc: null, fallidas: 0 })
)
vi.mock('@/lib/supabase/server', async () => {
  const { clienteConFallos } = await import('./lectura-fallida')
  return { createClient: async () => clienteConFallos(sesion) }
})
const centro = vi.hoisted(() => ({ id: '' }))
vi.mock('@/features/centros/contexto/get-contexto-centro', () => ({
  requireContextoCentro: async () => ({ centroId: centro.id }),
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
  redirect: (u: string) => {
    throw new Error(`REDIRECT ${u}`)
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/es/family',
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

const { default: FamilyNinoPage } = await import('@/app/[locale]/family/nino/[id]/page')
const { AgendaFamiliaView } = await import('@/features/agenda-diaria/components/AgendaFamiliaView')
const { NoSePudoLeer } = await import('@/shared/components/NoSePudoLeer')
const { default: FamilyRecibosPage } = await import('@/app/[locale]/family/recibos/page')

describe('las páginas de la familia no deciden con una lectura caída', () => {
  let nino: { id: string; familia_id: string }
  let legal: TestUser

  beforeAll(async () => {
    const c = await createTestCentro('Centro Familia Lecturas Caidas')
    centro.id = c.id
    const curso = await createTestCurso(c.id)
    const aula = await createTestAula(c.id, curso.id)
    nino = await createTestNino(c.id, 'Nino Familia Lecturas Caidas')
    await matricular(nino.id, aula.id, curso.id)
    legal = await createTestUser({ nombre: 'Legal Familia Lecturas Caidas' })
    await asignarRol(legal.id, c.id, 'tutor_legal')
    await crearFamiliaTutor(nino.familia_id, legal.id)
    // Los permisos que la app da al tutor legal principal que hacen falta aquí (`permisosDefault`).
    await crearVinculo(nino.id, legal.id, 'tutor_legal_principal', {
      puede_ver_info_medica: true,
      puede_ver_agenda: true,
    })
    sesion.actual = await clientFor(legal)
  })

  afterAll(async () => {
    sesion.actual = null
    if (legal) await deleteTestUser(legal.id)
  })

  afterEach(() => {
    sesion.fallaTabla = null
    sesion.fallaSoloLaN = null
  })

  const paginas = {
    nino: () =>
      FamilyNinoPage({
        params: Promise.resolve({ locale: 'es', id: nino.id }),
        searchParams: Promise.resolve({}),
      }),
    recibos: () => FamilyRecibosPage({ params: Promise.resolve({ locale: 'es' }) }),
  }

  async function pintar(cual: keyof typeof paginas): Promise<unknown> {
    try {
      return await paginas[cual]()
    } catch (e) {
      return e
    }
  }

  /** Cuántas veces lee la página la tabla, con todo bien (la premisa de cada caso). */
  async function lecturasDe(cual: keyof typeof paginas, tabla: string) {
    sesion.fallaTabla = tabla
    sesion.fallaSoloLaN = 10_000
    sesion.vistas = 0
    const r = await pintar(cual)
    expect(r, `premisa: la página ${cual} sale con todo leído`).not.toBeInstanceOf(Error)
    return sesion.vistas ?? 0
  }

  it.each([
    ['nino', 'vinculos_familiares', 'ficha del niño: vínculo'],
    ['recibos', 'centros', 'recibos de la familia: centro'],
  ] as const)('%s con una lectura de %s caída: para en «%s»', async (cual, tabla, donde) => {
    const n = await lecturasDe(cual, tabla)
    expect(n, `premisa: la página ${cual} lee ${tabla}`).toBeGreaterThan(0)
    const dondes: string[] = []
    for (let i = 1; i <= n; i++) {
      sesion.fallaTabla = tabla
      sesion.fallaSoloLaN = i
      sesion.vistas = 0
      const e = await pintar(cual)
      if (esLecturaFallida(e)) dondes.push(e.donde)
    }
    expect(dondes).toContain(donde)
  })

  // La agenda del día es una SECCIÓN de la ficha (pantalla diaria, «por sección y a mano»): si no se lee,
  // lo dice en su sitio y la ficha sigue. Antes salía vacía («hoy no hay nada apuntado»).
  it('la ficha con la agenda del día caída: la sección lo dice y la ficha sigue', async () => {
    const bien = await pintar('nino')
    expect(bien, 'premisa: la ficha sale').not.toBeInstanceOf(Error)
    expect(propsDe(bien, AgendaFamiliaView), 'premisa: con permiso, pinta la agenda').not.toBeNull()
    expect(propsDe(bien, NoSePudoLeer), 'premisa: sin nada caído, ningún aviso').toBeNull()

    sesion.fallaTabla = 'agendas_diarias'
    sesion.vistas = 0
    const arbol = await pintar('nino')
    expect(sesion.vistas, 'premisa: la página leyó la agenda').toBeGreaterThan(0)
    expect(arbol, 'la ficha sigue').not.toBeInstanceOf(Error)
    expect(propsDe(arbol, AgendaFamiliaView)).toBeNull()
    expect(propsDe<{ alcance: string }>(arbol, NoSePudoLeer)?.alcance).toBe('seccion')
  })
})
