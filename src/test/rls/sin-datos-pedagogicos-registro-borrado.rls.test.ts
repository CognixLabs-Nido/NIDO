import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'

import { propsDe, type SesionConFallos } from './lectura-fallida'
import { montarPaseComida, type PaseMontado } from './pase-comida-montaje'
import { clientFor, serviceClient } from './setup'

/**
 * C, defecto 2 de 2 (2026-11-24): un niño con su registro de datos pedagógicos BORRADO
 * (`deleted_at`). `nino_toma_comida_solida` no miraba `deleted_at` y seguía decidiendo con lo borrado.
 * Decisión del responsable (2026-11-24): «Un niño al que le borraron los datos pedagógicos no es un
 * niño con datos antiguos, es un niño sin datos. La función filtra los borrados, y el PR cuenta los
 * dos defectos por separado con su medición cada uno».
 *
 * El registro borrado dice «biberón»: con lo borrado decidiendo, Beto desaparece del pase (FALSE) y
 * nadie puede apuntar lo que come. El defecto 1 (sin registro ninguno) se mide en
 * `sin-datos-pedagogicos-sin-registro.rls.test.ts`.
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

function marcaSinDatos(f: unknown): unknown {
  return (f as { sinDatosPedagogicos?: unknown }).sinDatosPedagogicos
}

describe('defecto 2: niño con el registro de datos pedagógicos BORRADO', () => {
  let pase: PaseMontado
  let beto: string
  let carla: string

  beforeAll(async () => {
    pase = await montarPaseComida('Centro Registro Pedagogico Borrado', HOY, [
      {
        nombre: 'Beto Borrado',
        datos: { lactancia_estado: 'biberon', deleted_at: new Date().toISOString() },
      },
      { nombre: 'Carla Solidos', datos: { lactancia_estado: 'finalizada' } },
    ])
    ;[beto, carla] = pase.ids
    sesion.actual = await clientFor(pase.profe)
  }, 90_000)

  afterAll(async () => {
    sesion.actual = null
    await pase?.desmontar()
  }, 90_000)

  it('la función contesta NULL: lo borrado no decide', async () => {
    const fila = await serviceClient
      .from('datos_pedagogicos_nino')
      .select('lactancia_estado, deleted_at')
      .eq('nino_id', beto)
      .single()
    expect(fila.error, 'premisa: se lee la fila').toBeNull()
    expect(fila.data?.deleted_at, 'premisa: el registro de Beto está borrado').not.toBeNull()
    expect(fila.data?.lactancia_estado, 'premisa: lo borrado dice biberón').toBe('biberon')

    const profe = await clientFor(pase.profe)
    const control = await profe.rpc('nino_toma_comida_solida', { p_nino_id: carla })
    expect(control.error, 'control: la profe llama a la función').toBeNull()
    expect(control.data, 'control: Carla (lactancia finalizada) come sólidos').toBe(true)

    const r = await profe.rpc('nino_toma_comida_solida', { p_nino_id: beto })
    expect(r.error).toBeNull()
    expect(r.data, 'registro borrado = sin datos: NULL').toBeNull()
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

    const filaBeto = s.filas.find((f) => f.nino.id === beto)
    expect(filaBeto, 'Beto sale en el pase (lo borrado lo sacaba)').toBeTruthy()
    expect.soft(marcaSinDatos(filaBeto), 'Beto sale marcado: ni que sí ni que no').toBe(true)

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
    expect(aviso.textContent).toContain('Beto Borrado')
    expect(aviso.textContent).not.toContain('Carla Solidos')
  })
})
