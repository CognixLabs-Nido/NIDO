import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'

import { propsDe, type SesionConFallos } from './lectura-fallida'
import {
  asignarProfeAula,
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * Los sólidos no se suponen (C, 2026-11-23, va primero). El pase de comidas lista a los niños que
 * toman sólidos: `nino_toma_comida_solida` por niño. Si esa llamada FALLA, el helper contestaba
 * `toma: true` («fallback seguro: incluir»): un bebé de biberón cuya lactancia no se pudo leer sale
 * en el pase como si comiera sólidos, y a la profe se le ofrece apuntarle el primer plato. Un fallo
 * leído como REGLA.
 *
 * Lo que se afirma (decisión del 2026-11-23): si no se pudo leer, el niño NO cuenta como que come
 * sólidos (el valor que no hace daño) y la pantalla lo dice, nombrándolo.
 *
 * Los dos helpers: el de los cuatro momentos, por la PÁGINA real de la profe; el de un momento
 * (`getPaseDeListaComida`, sin llamador en la app hoy), llamado directo.
 */
const sesion = vi.hoisted(
  (): SesionConFallos => ({ actual: null, fallaTabla: null, fallaRpc: null, fallidas: 0 })
)
vi.mock('@/lib/supabase/server', async () => {
  const { clienteConFallos: con } = await import('./lectura-fallida')
  return { createClient: async () => con(sesion) }
})
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
  redirect: (u: string) => {
    throw new Error(`REDIRECT ${u}`)
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/es/teacher',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// El texto lleva sus parámetros: así se ve a quién nombra el aviso.
vi.mock('next-intl', () => ({
  useTranslations: () =>
    Object.assign(
      (k: string, v?: Record<string, string>) => (v ? `${k} ${JSON.stringify(v)}` : k),
      {
        has: () => true,
      }
    ),
}))
vi.mock('next-intl/server', () => ({
  getTranslations: async () =>
    Object.assign((k: string) => k, { has: () => true, rich: (k: string) => k }),
}))

const { default: PaginaComida } = await import('@/app/[locale]/teacher/aula/[id]/comida/page')
const { PaseDeListaComidaCliente } =
  await import('@/features/menus/components/PaseDeListaComidaCliente')
const { getPaseDeListaComida } = await import('@/features/menus/queries/get-pase-de-lista-comida')
type PropsPase = Parameters<typeof PaseDeListaComidaCliente>[0]
type Estado = PropsPase['states']['comida']

const HOY = hoyMadrid()
const [ANIO, MES] = HOY.split('-').map(Number)
const RPC = 'nino_toma_comida_solida'

/** Los niños que el estado nombra como no comprobados. */
function sinComprobar(s: Extract<Estado, { kind: 'listo' }>): string[] {
  return s.sinComprobarSolidos.map((n) => n.id)
}

describe('los sólidos no se suponen', () => {
  let centroId: string
  let aulaId: string
  let bebe: string
  let mayor: string
  let profe: TestUser
  let admin: TestUser

  beforeAll(async () => {
    const centro = await createTestCentro('Centro Solidos No Se Suponen')
    centroId = centro.id
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    aulaId = aula.id
    bebe = (await createTestNino(centro.id, 'Bruno Biberon')).id
    mayor = (await createTestNino(centro.id, 'Carla Solidos')).id
    for (const [id, lactancia] of [
      [bebe, 'biberon'],
      [mayor, 'finalizada'],
    ] as const) {
      await matricular(id, aula.id, curso.id)
      const d = await serviceClient.from('datos_pedagogicos_nino').insert({
        nino_id: id,
        lactancia_estado: lactancia,
        control_esfinteres: 'panal_completo',
        tipo_alimentacion: 'omnivora',
        idiomas_casa: ['es'],
        tiene_hermanos_en_centro: false,
      })
      if (d.error) throw new Error(`datos pedagógicos ${lactancia}: ${d.error.message}`)
    }
    admin = await createTestUser({ nombre: 'Admin Solidos' })
    await asignarRol(admin.id, centro.id, 'admin')
    profe = await createTestUser({ nombre: 'Profe Solidos' })
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarProfeAula(profe.id, aula.id, curso.id)
    const dia = await serviceClient
      .from('dias_centro')
      .insert({ centro_id: centro.id, fecha: HOY, tipo: 'lectivo' })
    if (dia.error) throw new Error(`día: ${dia.error.message}`)
    const p = await serviceClient
      .from('plantillas_menu_mensual')
      .insert({
        centro_id: centro.id,
        anio: ANIO,
        mes: MES,
        estado: 'publicada',
        creada_por: admin.id,
      })
      .select('id')
      .single()
    if (p.error || !p.data) throw new Error(`plantilla: ${p.error?.message}`)
    const m = await serviceClient
      .from('menu_dia')
      .insert({ plantilla_id: p.data.id, fecha: HOY, comida_primero: 'Crema de calabaza' })
    if (m.error) throw new Error(`menú: ${m.error.message}`)
    sesion.actual = await clientFor(profe)
  }, 60_000)

  afterAll(async () => {
    sesion.actual = null
    await serviceClient.from('datos_pedagogicos_nino').delete().in('nino_id', [bebe, mayor])
    await serviceClient.from('plantillas_menu_mensual').delete().eq('centro_id', centroId)
    await serviceClient.from('dias_centro').delete().eq('centro_id', centroId)
    await deleteTestCentro(centroId)
    if (profe) await deleteTestUser(profe.id)
    if (admin) await deleteTestUser(admin.id)
  }, 60_000)

  afterEach(() => {
    sesion.fallaRpc = null
  })

  async function estadoDeLaPagina(): Promise<Estado | Error> {
    sesion.fallidas = 0
    try {
      const el = await PaginaComida({
        params: Promise.resolve({ locale: 'es', id: aulaId }),
        searchParams: Promise.resolve({ fecha: HOY, momento: 'comida' }),
      })
      const props = propsDe<PropsPase>(el, PaseDeListaComidaCliente)
      if (!props) throw new Error('la página no pinta el pase')
      return props.states.comida
    } catch (e) {
      return e as Error
    }
  }

  it('control: con la lectura bien, el pase lista a Carla y no a Bruno', async () => {
    const s = await estadoDeLaPagina()
    expect(s, 'premisa: la página pinta el pase').not.toBeInstanceOf(Error)
    if (s instanceof Error || s.kind !== 'listo') throw new Error(`estado: ${JSON.stringify(s)}`)
    const ids = s.filas.map((f) => f.nino.id)
    expect(ids, 'Carla come sólidos').toContain(mayor)
    expect(ids, 'Bruno es de biberón').not.toContain(bebe)
    expect(sinComprobar(s), 'nada sin comprobar').toEqual([])
  })

  it('pase de los cuatro momentos: si no se pudo leer, Bruno no sale y la pantalla lo dice', async () => {
    sesion.fallaRpc = RPC
    const s = await estadoDeLaPagina()
    expect(sesion.fallidas, 'premisa: la llamada de los sólidos falló').toBeGreaterThan(0)
    if (s instanceof Error) {
      // No pinta el pase: lo dice, y no ofrece nada.
      expect(s.message).not.toBe('la página no pinta el pase')
      return
    }
    if (s.kind !== 'listo') throw new Error(`estado: ${JSON.stringify(s)}`)
    expect
      .soft(
        s.filas.map((f) => f.nino.id),
        'a Bruno no se le ofrece comida'
      )
      .not.toContain(bebe)
    expect
      .soft(sinComprobar(s), 'la pantalla nombra a los no comprobados')
      .toEqual(expect.arrayContaining([bebe, mayor]))
    // Y la PANTALLA: el pase pintado con lo que la página le da avisa, nombrando a Bruno.
    render(
      createElement(PaseDeListaComidaCliente, {
        aulaId,
        fecha: HOY,
        momentoInicial: 'comida',
        states: { desayuno: s, media_manana: s, comida: s, merienda: s },
        locale: 'es',
      })
    )
    expect(screen.getByTestId('aviso-sin-comprobar-solidos').textContent).toContain('Bruno Biberon')
  })

  it('pase de un momento: lo mismo', async () => {
    sesion.fallaRpc = RPC
    sesion.fallidas = 0
    let s: Estado | Error
    try {
      s = await getPaseDeListaComida(aulaId, HOY, 'comida')
    } catch (e) {
      s = e as Error
    }
    expect(sesion.fallidas, 'premisa: la llamada de los sólidos falló').toBeGreaterThan(0)
    if (s instanceof Error) return
    if (s.kind !== 'listo') throw new Error(`estado: ${JSON.stringify(s)}`)
    expect
      .soft(
        s.filas.map((f) => f.nino.id),
        'a Bruno no se le ofrece comida'
      )
      .not.toContain(bebe)
    expect
      .soft(sinComprobar(s), 'la pantalla nombra a los no comprobados')
      .toEqual(expect.arrayContaining([bebe, mayor]))
  })
})
