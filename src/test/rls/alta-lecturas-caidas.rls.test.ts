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
  serviceClient,
  type TestUser,
} from './setup'

/**
 * La página del alta con una lectura caída (censo C, B1, lista blanca de `nido/lectura-mira-el-error`,
 * 2026-11-26). Cada una de estas lecturas decidía algo con «no hay»: las matrículas («sin matrícula»: el
 * asistente se reabría a un alumno activo), el consentimiento médico (la casilla sin marcar a quien ya
 * consintió), el de imagen («no puede salir en fotos»), el mandato («no hay», y pedía firmar otro) y el
 * perfil (el nombre en blanco). Ahora la página lanza `LecturaFallida` y la pinta `alta/error.tsx`.
 *
 * Se afirma el `donde` de la LecturaFallida: que paró ESA lectura, no otra de la misma tabla.
 *
 * Sin medir aquí: la plantilla de imagen (`sinPlantilla`): con `autorizaciones` caída para antes
 * `panelFirma`, que ya lanzaba. Y la degradación deliberada de los rellenos (hermanos, teléfono de la lista
 * de espera): la primera lectura de `vinculos_familiares` es la puerta, que para antes.
 *
 * La PÁGINA real con la sesión real del tutor legal, contra la base efímera. Fixtures ficticios.
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

describe('la página del alta no decide con una lectura caída', () => {
  let nino: { id: string; familia_id: string }
  let legal: TestUser

  beforeAll(async () => {
    const centro = await createTestCentro('Centro Alta Lecturas Caidas')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id, 'Nino Alta Lecturas Caidas')
    const matricula = await matricular(nino.id, aula.id, curso.id)
    legal = await createTestUser({ nombre: 'Legal Alta Lecturas Caidas' })
    await asignarRol(legal.id, centro.id, 'tutor_legal')
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
    sesion.fallaRpc = null
  })

  async function pagina(): Promise<unknown> {
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

  it('control: con todo leído, la página monta el asistente', async () => {
    const arbol = await pagina()
    expect(arbol, 'no lanza').not.toBeInstanceOf(Error)
    expect(propsDe(arbol, AltaTutorWizard), 'monta el asistente').not.toBeNull()
  })

  it.each([
    ['tabla', 'matriculas', 'alta: matrículas'],
    ['tabla', 'usuarios', 'alta: perfil'],
    ['tabla', 'consentimientos', 'alta: consentimiento médico'],
    ['tabla', 'mandatos_sepa', 'alta: mandato'],
    ['rpc', 'existe_consentimiento_imagen', 'alta: consentimiento de imagen'],
  ])('con %s %s caída: lanza LecturaFallida en «%s»', async (clase, nombre, donde) => {
    if (clase === 'tabla') sesion.fallaTabla = nombre
    else sesion.fallaRpc = nombre
    const e = await pagina()
    expect(sesion.fallidas, 'premisa: la lectura falló').toBeGreaterThan(0)
    expect(esLecturaFallida(e), `esperaba una LecturaFallida, llegó ${String(e)}`).toBe(true)
    expect((e as { donde: string }).donde).toBe(donde)
  })
})
