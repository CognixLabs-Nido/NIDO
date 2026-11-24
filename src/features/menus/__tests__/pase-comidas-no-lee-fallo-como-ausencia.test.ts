import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El pase de comidas, por helper (C, 2026-11-23). Cada lectura de los dos helpers del pase, si falla,
 * hace que el pase no salga: ni «sin plantilla», ni «día sin menú», ni «centro cerrado», ni una lista
 * sin lo ya apuntado (sobre la que la profe pisaría lo que nadie vio). Los sólidos van aparte
 * (`solidos-no-se-suponen.test.tsx`), las alertas en `fallo-no-es-sin-alergia.test.ts`.
 */

const NINO = '11111111-1111-4111-8111-111111111111'
const AULA = '22222222-2222-4222-8222-222222222222'
const FECHA = '2026-10-26'

type Resultado = { data: unknown; error: { message: string } | null }
let falla: string | null

function datosDe(nombre: string): unknown {
  switch (nombre) {
    case 'aulas':
      return { centro_id: 'centro' }
    case 'tipo_de_dia':
      return 'lectivo'
    case 'plantillas_menu_mensual':
      return { id: 'plantilla' }
    case 'menu_dia':
      return { id: 'menu', fecha: FECHA }
    case 'matriculas':
      return [{ ninos: { id: NINO, nombre: 'Carla', apellidos: 'Demo', foto_url: null } }]
    case 'nino_toma_comida_solida':
      return true
    case 'agendas_diarias':
      return [{ id: 'agenda', nino_id: NINO }]
    case 'comidas':
      return [
        {
          id: 'c1',
          agenda_id: 'agenda',
          momento: 'comida',
          cantidad: 'poco',
          descripcion: 'Crema sin queso',
          tipo_plato: 'primer_plato',
        },
      ]
    default:
      return []
  }
}

function consulta(nombre: string): unknown {
  const r = (): Resultado =>
    nombre === falla
      ? { data: null, error: { message: 'fallo' } }
      : { data: datosDe(nombre), error: null }
  const q: unknown = new Proxy(
    {},
    {
      get: (_, prop) =>
        prop === 'then' ? (resolve: (x: Resultado) => unknown) => resolve(r()) : () => q,
    }
  )
  return q
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: consulta, rpc: consulta }),
}))

const { getPaseDeListaComida } = await import('../queries/get-pase-de-lista-comida')
const { getPaseDeListaComidaTodosMomentos } =
  await import('../queries/get-pase-de-lista-comida-todos-momentos')

const helpers: Array<[string, () => Promise<unknown>]> = [
  ['un momento', () => getPaseDeListaComida(AULA, FECHA, 'comida')],
  ['cuatro momentos', async () => (await getPaseDeListaComidaTodosMomentos(AULA, FECHA)).comida],
]

const LECTURAS = [
  'aulas',
  'tipo_de_dia',
  'plantillas_menu_mensual',
  'menu_dia',
  'matriculas',
  'agendas_diarias',
  'comidas',
] as const

describe('el pase de comidas no lee un fallo como ausencia ni como regla', () => {
  beforeEach(() => {
    falla = null
  })

  it.each(helpers)('%s · control: con todo leído, sale Carla con lo apuntado', async (_, h) => {
    const s = (await h()) as { kind: string; filas: unknown[]; existentes: unknown[] }
    expect(s.kind).toBe('listo')
    expect(s.filas).toHaveLength(1)
    expect(s.existentes).toEqual([expect.objectContaining({ cantidad: 'poco' })])
  })

  for (const [nombre, h] of helpers)
    it.each(LECTURAS)(`${nombre} · si falla %s, el pase no sale`, async (lectura) => {
      falla = lectura
      await expect(h(), `falla ${lectura}`).rejects.toThrow('fallo')
    })
})
