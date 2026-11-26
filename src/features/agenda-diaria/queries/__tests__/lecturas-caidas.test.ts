import { beforeEach, describe, expect, it, vi } from 'vitest'

import { esLecturaFallida } from '@/shared/lib/lectura-fallida'

/**
 * Censo C (B1, lista blanca, 2026-11-26): la agenda con una lectura caída.
 *  - `getAgendaDelDia` (la ficha del niño y la tarjeta de la agenda del aula): sin la cabecera o sin un
 *    tipo de evento, la agenda salía vacía y la profe veía los formularios en blanco;
 *  - `getAgendasAulaDelDia` (la agenda del aula): sin los niños, «no hay niños» (esa lectura va por un
 *    helper que devuelve el builder: la regla de lint no la ve); sin las cabeceras o los eventos, los
 *    contadores a 0.
 * Ahora lanzan `LecturaFallida`. Quién la pinta y dónde, en los tests de la tarjeta y de la página. Cada
 * bloque empieza por su premisa. Fixtures ficticios.
 */
const { estado } = vi.hoisted(() => ({
  estado: { filas: {} as Record<string, unknown>, falla: null as string | null },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: async () => ({ data: [], error: null }),
    from: (tabla: string) => {
      const responder = (una: boolean) => {
        if (estado.falla === tabla)
          return { data: null, error: { code: 'XX000', message: 'caída' } }
        const v = estado.filas[tabla] ?? []
        if (una) return { data: Array.isArray(v) ? (v[0] ?? null) : v, error: null }
        return { data: Array.isArray(v) ? v : [v], error: null }
      }
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'in', 'order']) c[m] = () => c
      c.maybeSingle = async () => responder(true)
      c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(responder(false)).then(res, rej)
      return c
    },
  }),
}))

const { getAgendaDelDia } = await import('../get-agenda-del-dia')
const { getAgendasAulaDelDia } = await import('../get-agendas-aula-del-dia')

async function lanzaEn(p: Promise<unknown>, donde: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err
  )
  expect(esLecturaFallida(e), `esperaba una LecturaFallida, llegó ${String(e)}`).toBe(true)
  expect((e as { donde: string }).donde).toBe(donde)
}

const EVENTO = { id: 'e-1', agenda_id: 'ag-1' }

beforeEach(() => {
  estado.falla = null
  estado.filas = {
    matriculas: [
      {
        ninos: {
          id: 'n-1',
          nombre: 'Niño',
          apellidos: 'Demo',
          fecha_nacimiento: '2025-01-01',
          foto_url: null,
        },
      },
    ],
    agendas_diarias: [{ id: 'ag-1', nino_id: 'n-1', fecha: '2026-11-26' }],
    comidas: [EVENTO],
    biberones: [EVENTO],
    suenos: [EVENTO],
    deposiciones: [EVENTO],
  }
})

describe('getAgendaDelDia', () => {
  it('premisa: con todo leído, la cabecera y un evento de cada tipo', async () => {
    const a = await getAgendaDelDia('n-1', '2026-11-26')
    expect(a.cabecera?.id).toBe('ag-1')
    for (const k of ['comidas', 'biberones', 'suenos', 'deposiciones'] as const)
      expect(a[k], k).toHaveLength(1)
  })

  it.each([
    ['agendas_diarias', 'agenda del día: cabecera'],
    ['comidas', 'agenda del día: comidas'],
    ['biberones', 'agenda del día: biberones'],
    ['suenos', 'agenda del día: sueños'],
    ['deposiciones', 'agenda del día: deposiciones'],
  ])('con %s caída: no sale vacía, lanza en «%s»', async (tabla, donde) => {
    estado.falla = tabla
    await lanzaEn(getAgendaDelDia('n-1', '2026-11-26'), donde)
  })
})

describe('getAgendasAulaDelDia', () => {
  it('premisa: con todo leído, el niño con su agenda y un evento de cada tipo', async () => {
    const [r] = await getAgendasAulaDelDia('a-1', '2026-11-26')
    expect(r?.agenda_id).toBe('ag-1')
    expect(r?.counts).toEqual({ comidas: 1, biberones: 1, suenos: 1, deposiciones: 1 })
  })

  it.each([
    ['matriculas', 'agenda del aula: niños'],
    ['agendas_diarias', 'agenda del aula: cabeceras'],
    ['comidas', 'agenda del aula: comidas'],
    ['biberones', 'agenda del aula: biberones'],
    ['suenos', 'agenda del aula: sueños'],
    ['deposiciones', 'agenda del aula: deposiciones'],
  ])('con %s caída: no dice «nada», lanza en «%s»', async (tabla, donde) => {
    estado.falla = tabla
    await lanzaEn(getAgendasAulaDelDia('a-1', '2026-11-26'), donde)
  })
})
