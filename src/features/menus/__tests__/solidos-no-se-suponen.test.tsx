import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaseDeListaComidaState } from '../types'

/**
 * Los sólidos no se suponen (C, 2026-11-23), en unidad: lo mismo que
 * `src/test/rls/solidos-no-se-suponen.rls.test.ts` mide contra la base, aquí con un doble, para poder
 * mutar sin la CI. Si `nino_toma_comida_solida` falla, el niño no sale en la lista (el valor que no
 * hace daño: «no come sólidos») y el estado lo nombra; la pantalla lo dice, también cuando la lista
 * se queda vacía (no «ningún niño come sólidos»).
 */

const NINO = '11111111-1111-4111-8111-111111111111'
const AULA = '22222222-2222-4222-8222-222222222222'
const FECHA = '2026-10-26'

type Resultado = { data: unknown; error: { message: string } | null }
let solidos: Resultado

function resultadoDe(tabla: string): Resultado {
  switch (tabla) {
    case 'matriculas':
      return {
        data: [{ ninos: { id: NINO, nombre: 'Bruno', apellidos: 'Biberon', foto_url: null } }],
        error: null,
      }
    case 'aulas':
      return { data: { centro_id: 'centro' }, error: null }
    case 'plantillas_menu_mensual':
      return { data: { id: 'plantilla' }, error: null }
    case 'menu_dia':
      return { data: { id: 'menu', fecha: FECHA }, error: null }
    default:
      return { data: [], error: null }
  }
}

function consulta(resultado: () => Resultado): unknown {
  const q: unknown = new Proxy(
    {},
    {
      get: (_, prop) =>
        prop === 'then' ? (resolve: (r: Resultado) => unknown) => resolve(resultado()) : () => q,
    }
  )
  return q
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (tabla: string) => consulta(() => resultadoDe(tabla)),
    rpc: (fn: string) =>
      consulta(() =>
        fn === 'nino_toma_comida_solida'
          ? solidos
          : fn === 'tipo_de_dia'
            ? { data: 'lectivo', error: null }
            : { data: [], error: null }
      ),
  }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/es/teacher',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next-intl', () => ({
  useTranslations: () =>
    Object.assign(
      (k: string, v?: Record<string, string>) => (v ? `${k} ${JSON.stringify(v)}` : k),
      {
        has: () => true,
      }
    ),
}))

const { getPaseDeListaComida } = await import('../queries/get-pase-de-lista-comida')
const { getPaseDeListaComidaTodosMomentos } =
  await import('../queries/get-pase-de-lista-comida-todos-momentos')
const { PaseDeListaComidaCliente } = await import('../components/PaseDeListaComidaCliente')

type Listo = Extract<PaseDeListaComidaState, { kind: 'listo' }>
const helpers: Array<[string, () => Promise<PaseDeListaComidaState>]> = [
  ['un momento', () => getPaseDeListaComida(AULA, FECHA, 'comida')],
  ['cuatro momentos', async () => (await getPaseDeListaComidaTodosMomentos(AULA, FECHA)).comida],
]

function listo(s: PaseDeListaComidaState): Listo {
  if (s.kind !== 'listo') throw new Error(`premisa: estado listo, salió ${s.kind}`)
  return s
}

describe('los sólidos no se suponen', () => {
  beforeEach(() => {
    solidos = { data: true, error: null }
  })

  it.each(helpers)('%s · control: si come sólidos, sale y nada sin comprobar', async (_, h) => {
    const s = listo(await h())
    expect(s.filas.map((f) => f.nino.id)).toEqual([NINO])
    expect(s.filas[0].sinDatosPedagogicos, 'tiene datos').toBe(false)
    expect(s.sinComprobarSolidos).toEqual([])
  })

  it.each(helpers)(
    '%s · sin datos pedagógicos (NULL): SALE marcado, ni que sí ni que no',
    async (_, h) => {
      solidos = { data: null, error: null }
      const s = listo(await h())
      expect(
        s.filas.map((f) => f.nino.id),
        'sale: con FALSE nadie apuntaría lo que come'
      ).toEqual([NINO])
      expect(s.filas[0].sinDatosPedagogicos, 'marcado: con TRUE comería como los demás').toBe(true)
      expect(s.sinComprobarSolidos, 'NULL no es un fallo de lectura').toEqual([])
    }
  )

  it.each(helpers)('%s · control: si es de biberón, no sale y nada sin comprobar', async (_, h) => {
    solidos = { data: false, error: null }
    const s = listo(await h())
    expect(s.filas).toEqual([])
    expect(s.sinComprobarSolidos).toEqual([])
  })

  it.each(helpers)('%s · si la llamada falla, no sale y el estado lo nombra', async (_, h) => {
    solidos = { data: null, error: { message: 'fallo' } }
    const s = listo(await h())
    expect(s.filas, 'no se supone que come sólidos').toEqual([])
    expect(
      s.sinComprobarSolidos.map((n) => n.id),
      'nombrado'
    ).toEqual([NINO])
  })

  function pintar(s: Listo) {
    render(
      createElement(PaseDeListaComidaCliente, {
        aulaId: AULA,
        fecha: FECHA,
        momentoInicial: 'comida',
        states: { desayuno: s, media_manana: s, comida: s, merienda: s },
        locale: 'es',
      })
    )
  }
  const menu = { id: 'menu', fecha: FECHA } as Listo['menu']
  const bruno = { id: NINO, nombre: 'Bruno', apellidos: 'Biberon', foto_url: null }
  const carla = { id: 'carla', nombre: 'Carla', apellidos: 'Solidos', foto_url: null }

  it('pantalla · con la lista vacía, avisa de quién no se comprobó (no «ninguno come sólidos»)', () => {
    pintar({ kind: 'listo', menu, filas: [], existentes: [], sinComprobarSolidos: [bruno] })
    expect(screen.getByTestId('aviso-sin-comprobar-solidos').textContent).toContain('Bruno Biberon')
    expect(screen.queryByText(/sin_ninos_solidos/)).toBeNull()
  })

  it('pantalla · con otros en la lista, avisa encima de ella', () => {
    pintar({
      kind: 'listo',
      menu,
      filas: [{ nino: carla, alergiaGrave: false, sinDatosPedagogicos: false }],
      existentes: [],
      sinComprobarSolidos: [bruno],
    })
    expect(screen.getByTestId('aviso-sin-comprobar-solidos').textContent).toContain('Bruno Biberon')
    expect(screen.getByText('Carla Solidos'), 'premisa: la lista se pinta').toBeTruthy()
  })

  it('pantalla · control: sin nadie sin comprobar, no hay aviso', () => {
    pintar({ kind: 'listo', menu, filas: [], existentes: [], sinComprobarSolidos: [] })
    expect(screen.queryByTestId('aviso-sin-comprobar-solidos')).toBeNull()
  })

  it('pantalla · el niño sin datos pedagógicos se nombra ENCIMA de la lista y su fila lo dice', () => {
    pintar({
      kind: 'listo',
      menu,
      filas: [
        { nino: bruno, alergiaGrave: false, sinDatosPedagogicos: true },
        { nino: carla, alergiaGrave: false, sinDatosPedagogicos: false },
      ],
      existentes: [],
      sinComprobarSolidos: [],
    })
    const aviso = screen.getByTestId('aviso-sin-datos-pedagogicos')
    expect(aviso.textContent).toContain('Bruno Biberon')
    expect(aviso.textContent).not.toContain('Carla Solidos')
    expect(screen.getByText('Bruno Biberon'), 'sale en la lista').toBeTruthy()
    expect(
      screen.getAllByText('badge_sin_datos_pedagogicos'),
      'su fila, y solo la suya'
    ).toHaveLength(1)
  })

  it('pantalla · control: con todos con datos, ni aviso ni etiqueta', () => {
    pintar({
      kind: 'listo',
      menu,
      filas: [{ nino: carla, alergiaGrave: false, sinDatosPedagogicos: false }],
      existentes: [],
      sinComprobarSolidos: [],
    })
    expect(screen.queryByTestId('aviso-sin-datos-pedagogicos')).toBeNull()
    expect(screen.queryByText('badge_sin_datos_pedagogicos')).toBeNull()
  })
})
