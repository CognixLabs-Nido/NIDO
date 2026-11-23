import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
 * El pase de comidas no se pasa sobre lo que no se leyó (C, 2026-11-23). Si falla la lectura de las
 * comidas ya apuntadas, `getPaseDeListaComidaTodosMomentos` da la lista con `existentes: []`: el niño
 * que ya tenía su primer plato apuntado sale en blanco. Si la profe lo marca, la acción actualiza por
 * clave (agenda, momento, plato) y pisa la cantidad y la descripción que nadie vio.
 *
 * La cadena: la PÁGINA real con la sesión real de la profe del aula, las props que le da al pase y la
 * acción real con lo que el pase construye para una fila marcada (`PaseDeListaComidaCliente`: el
 * plato con la descripción del menú). El clic en la rejilla no se reproduce: el pase manda eso.
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
vi.mock('next-intl/server', () => ({
  getTranslations: async () =>
    Object.assign((k: string) => k, { has: () => true, rich: (k: string) => k }),
}))

const { default: PaginaComida } = await import('@/app/[locale]/teacher/aula/[id]/comida/page')
const { PaseDeListaComidaCliente } =
  await import('@/features/menus/components/PaseDeListaComidaCliente')
const { batchRegistrarComidasPlatos } =
  await import('@/features/menus/actions/batch-registrar-comidas-platos')
type PropsPase = Parameters<typeof PaseDeListaComidaCliente>[0]

const HOY = hoyMadrid()
const [ANIO, MES] = HOY.split('-').map(Number)
const PRIMERO = 'Crema de calabaza'
const APUNTADA = { cantidad: 'poco', descripcion: 'Crema sin queso (la madre lo pidió)' } as const

describe('el pase de comidas no se pasa sobre lo que no se leyó', () => {
  let centroId: string
  let aulaId: string
  let ninoId: string
  let menuDiaId: string
  let agendaId: string
  let profe: TestUser
  let admin: TestUser

  beforeAll(async () => {
    const centro = await createTestCentro('Centro Comidas No Pisa')
    centroId = centro.id
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    aulaId = aula.id
    ninoId = (await createTestNino(centro.id, 'Carla Comidas No Pisa')).id
    await matricular(ninoId, aula.id, curso.id)
    admin = await createTestUser({ nombre: 'Admin Comidas No Pisa' })
    await asignarRol(admin.id, centro.id, 'admin')
    profe = await createTestUser({ nombre: 'Profe Comidas No Pisa' })
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarProfeAula(profe.id, aula.id, curso.id)
    // Hoy, lectivo aunque la CI corra en fin de semana.
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
      .insert({ plantilla_id: p.data.id, fecha: HOY, comida_primero: PRIMERO })
      .select('id')
      .single()
    if (m.error || !m.data) throw new Error(`menú: ${m.error?.message}`)
    menuDiaId = m.data.id
    const a = await serviceClient
      .from('agendas_diarias')
      .insert({ nino_id: ninoId, fecha: HOY })
      .select('id')
      .single()
    if (a.error || !a.data) throw new Error(`agenda: ${a.error?.message}`)
    agendaId = a.data.id
    sesion.actual = await clientFor(profe)
  }, 60_000)

  afterAll(async () => {
    sesion.actual = null
    await serviceClient.from('comidas').delete().eq('agenda_id', agendaId)
    await serviceClient.from('agendas_diarias').delete().eq('id', agendaId)
    await serviceClient.from('menu_dia').delete().eq('id', menuDiaId)
    await serviceClient.from('plantillas_menu_mensual').delete().eq('centro_id', centroId)
    await serviceClient.from('dias_centro').delete().eq('centro_id', centroId)
    await deleteTestCentro(centroId)
    if (profe) await deleteTestUser(profe.id)
    if (admin) await deleteTestUser(admin.id)
  }, 60_000)

  beforeEach(async () => {
    // El primer plato de Carla, ya apuntado esta mañana (desde su agenda).
    await serviceClient.from('comidas').delete().eq('agenda_id', agendaId)
    const c = await serviceClient.from('comidas').insert({
      agenda_id: agendaId,
      momento: 'comida',
      tipo_plato: 'primer_plato',
      menu_dia_id: menuDiaId,
      ...APUNTADA,
    })
    if (c.error) throw new Error(`comida apuntada: ${c.error.message}`)
    sesion.fallidas = 0
  })

  afterEach(() => {
    sesion.fallaTabla = null
  })

  async function primerPlato() {
    const { data, error } = await serviceClient
      .from('comidas')
      .select('cantidad, descripcion')
      .eq('agenda_id', agendaId)
      .eq('momento', 'comida')
      .eq('tipo_plato', 'primer_plato')
      .single()
    if (error) throw new Error(`leer la comida: ${error.message}`)
    return data
  }

  async function pagina() {
    return PaginaComida({
      params: Promise.resolve({ locale: 'es', id: aulaId }),
      searchParams: Promise.resolve({ fecha: HOY, momento: 'comida' }),
    })
  }

  it('control: con la lectura bien, el pase trae lo apuntado de Carla', async () => {
    const props = propsDe<PropsPase>(await pagina(), PaseDeListaComidaCliente)
    expect(props, 'premisa: la página pinta el pase').not.toBeNull()
    const s = props!.states.comida
    expect(s.kind, 'premisa: hay menú y lista').toBe('listo')
    if (s.kind !== 'listo') return
    expect(
      s.filas.map((f) => f.nino.id),
      'premisa: Carla está en la lista'
    ).toContain(ninoId)
    expect(
      s.existentes.find((e) => e.nino_id === ninoId && e.tipo_plato === 'primer_plato')
    ).toMatchObject(APUNTADA)
  })

  it('si falla la lectura de las comidas, no se pasa sobre lo apuntado', async () => {
    sesion.fallaTabla = 'comidas'
    let el: unknown
    try {
      el = await pagina()
    } catch (e) {
      el = e
    }
    expect(sesion.fallidas, 'premisa: la lectura de las comidas falló').toBeGreaterThan(0)
    const props = el instanceof Error ? null : propsDe<PropsPase>(el, PaseDeListaComidaCliente)
    const s = props?.states.comida
    if (s && s.kind === 'listo' && s.filas.some((f) => f.nino.id === ninoId)) {
      // El pase ofrece a Carla: la profe la marca, y se manda lo que el pase construye.
      sesion.fallaTabla = null
      const r = await batchRegistrarComidasPlatos({
        fecha: HOY,
        momento: 'comida',
        menu_dia_id: menuDiaId,
        filas: [
          { nino_id: ninoId, tipo_plato: 'primer_plato', cantidad: 'todo', descripcion: PRIMERO },
        ],
      })
      expect(r.success, 'premisa: el guardado corrió').toBe(true)
      const fila = await primerPlato()
      expect.soft(fila.cantidad, 'la cantidad apuntada se conserva').toBe(APUNTADA.cantidad)
      expect
        .soft(fila.descripcion, 'la descripción apuntada se conserva')
        .toBe(APUNTADA.descripcion)
    } else {
      expect(el, 'el pase no sale en blanco: avisa').toBeInstanceOf(Error)
      expect(await primerPlato(), 'nada se tocó').toEqual(APUNTADA)
    }
  })
})
