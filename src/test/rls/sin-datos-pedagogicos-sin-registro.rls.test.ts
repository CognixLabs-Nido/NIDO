import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'

import { propsDe, type SesionConFallos } from './lectura-fallida'
import { montarPaseComida, type PaseMontado } from './pase-comida-montaje'
import { clientFor, serviceClient } from './setup'

/**
 * C, defecto 1 de 2 (2026-11-24): un niño SIN registro de datos pedagógicos. `nino_toma_comida_solida`
 * le contestaba TRUE («COALESCE de seguridad»): el pase de comidas le ofrecía el primer plato a un
 * bebé cuya lactancia nadie apuntó. Decisión del responsable (2026-11-23): «no inventar el dato en
 * ninguna dirección: que el niño SALGA en el pase marcado como «sin datos pedagógicos», no como que
 * sí ni como que no, y que la profe vea que falta ese dato antes de darle de comer».
 *
 * El otro defecto (un registro BORRADO que sigue decidiendo) se mide aparte, en
 * `sin-datos-pedagogicos-registro-borrado.rls.test.ts`: el PR los cuenta por separado.
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
vi.mock('next-intl', () => ({
  useTranslations: () =>
    Object.assign(
      (k: string, v?: Record<string, string>) => (v ? `${k} ${JSON.stringify(v)}` : k),
      { has: () => true }
    ),
}))
vi.mock('next-intl/server', () => ({
  getTranslations: async () =>
    Object.assign((k: string) => k, { has: () => true, rich: (k: string) => k }),
}))

const { default: PaginaComida } = await import('@/app/[locale]/teacher/aula/[id]/comida/page')
const { PaseDeListaComidaCliente } =
  await import('@/features/menus/components/PaseDeListaComidaCliente')
type PropsPase = Parameters<typeof PaseDeListaComidaCliente>[0]
type Estado = PropsPase['states']['comida']

const HOY = hoyMadrid()

/** La marca de la fila, leída sin depender de que el tipo ya la tenga (la medida abierta corre antes). */
function marcaSinDatos(f: unknown): unknown {
  return (f as { sinDatosPedagogicos?: unknown }).sinDatosPedagogicos
}

describe('defecto 1: niño SIN registro de datos pedagógicos', () => {
  let pase: PaseMontado
  let dani: string
  let carla: string

  beforeAll(async () => {
    pase = await montarPaseComida('Centro Sin Registro Pedagogico', HOY, [
      { nombre: 'Dani Sinregistro', datos: null },
      { nombre: 'Carla Solidos', datos: { lactancia_estado: 'finalizada' } },
    ])
    ;[dani, carla] = pase.ids
    sesion.actual = await clientFor(pase.profe)
  }, 90_000)

  afterAll(async () => {
    sesion.actual = null
    await pase?.desmontar()
  }, 90_000)

  it('la función contesta NULL («no se sabe»), ni TRUE ni FALSE', async () => {
    const filas = await serviceClient
      .from('datos_pedagogicos_nino')
      .select('id', { count: 'exact', head: true })
      .eq('nino_id', dani)
    expect(filas.error, 'premisa: se pudo contar').toBeNull()
    expect(filas.count, 'premisa: Dani no tiene ningún registro, ni borrado').toBe(0)

    const profe = await clientFor(pase.profe)
    const control = await profe.rpc('nino_toma_comida_solida', { p_nino_id: carla })
    expect(control.error, 'control: la profe llama a la función').toBeNull()
    expect(control.data, 'control: Carla (lactancia finalizada) come sólidos').toBe(true)

    const r = await profe.rpc('nino_toma_comida_solida', { p_nino_id: dani })
    expect(r.error).toBeNull()
    expect(r.data, 'sin registro no se sabe: NULL').toBeNull()
  })

  it('el pase lo lista MARCADO «sin datos pedagógicos», y la pantalla lo dice antes de darle de comer', async () => {
    const el = await PaginaComida({
      params: Promise.resolve({ locale: 'es', id: pase.aulaId }),
      searchParams: Promise.resolve({ fecha: HOY, momento: 'comida' }),
    })
    const props = propsDe<PropsPase>(el, PaseDeListaComidaCliente)
    expect(props, 'premisa: la página pinta el pase').toBeTruthy()
    const s = props!.states.comida as Estado
    if (s.kind !== 'listo') throw new Error(`estado: ${JSON.stringify(s)}`)

    const filaCarla = s.filas.find((f) => f.nino.id === carla)
    expect(filaCarla, 'control: Carla sale en el pase').toBeTruthy()
    expect.soft(marcaSinDatos(filaCarla), 'control: Carla tiene datos').toBe(false)

    const filaDani = s.filas.find((f) => f.nino.id === dani)
    expect(filaDani, 'Dani sale en el pase (con FALSE desaparecería)').toBeTruthy()
    expect.soft(marcaSinDatos(filaDani), 'Dani sale marcado: ni que sí ni que no').toBe(true)

    render(
      createElement(PaseDeListaComidaCliente, {
        aulaId: pase.aulaId,
        fecha: HOY,
        momentoInicial: 'comida',
        states: { desayuno: s, media_manana: s, comida: s, merienda: s },
        locale: 'es',
      })
    )
    const aviso = screen.getByTestId('aviso-sin-datos-pedagogicos')
    expect(aviso.textContent).toContain('Dani Sinregistro')
    expect(aviso.textContent).not.toContain('Carla Solidos')
  })
})
