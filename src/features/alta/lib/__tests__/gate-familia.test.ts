import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Gate del panel `/family` POR HIJO (hueco 4 del alta del 2º hijo, opción A).
 *
 * Un hijo está «en alta» solo si NO tiene matrícula `activa` y SÍ una no-`activa`. El
 * layout redirige al asistente únicamente cuando no hay ningún hijo activo. El rollover
 * (`activa` + `pendiente` del curso siguiente) no es alta y no bloquea nada.
 */

const NINO_A = '11111111-1111-4111-8111-111111111111'
const NINO_B = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'

let vinculosRows: Array<{ nino_id: string }>
let matriculasRows: Array<{ nino_id: string; estado: string }>
let user: { id: string } | null
const filtros: Array<[string, string, unknown]> = []

function builder(table: string) {
  const rows = table === 'vinculos_familiares' ? vinculosRows : matriculasRows
  const b = {
    select: () => b,
    eq: (col: string, val: unknown) => (filtros.push([table, `eq:${col}`, val]), b),
    in: (col: string, val: unknown) => (filtros.push([table, `in:${col}`, val]), b),
    is: (col: string, val: unknown) => (filtros.push([table, `is:${col}`, val]), b),
    then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
      resolve({ data: rows, error: null }),
  }
  return b
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => builder(table),
  }),
}))

// `cache` de React memoiza por request en el servidor; en el test se ejecuta tal cual.
vi.mock('react', async (orig) => ({
  ...(await orig<typeof import('react')>()),
  cache: <T>(fn: T) => fn,
}))

const { clasificarAltaPorHijo, destinoGateFamilia, estadoAltaFamilia } =
  await import('../gate-familia')

describe('clasificarAltaPorHijo + destinoGateFamilia', () => {
  it('(a) único hijo con matrícula pendiente → en alta y redirige a su asistente', () => {
    const estado = clasificarAltaPorHijo([NINO_A], [{ nino_id: NINO_A, estado: 'pendiente' }])
    expect(estado).toEqual({ ninosEnAlta: [NINO_A], hayNinoActivo: false })
    expect(destinoGateFamilia(estado)).toBe(NINO_A)
  })

  it('(b) un hijo activo + un hermano pendiente → sin redirect, el hermano en alta', () => {
    const estado = clasificarAltaPorHijo(
      [NINO_A, NINO_B],
      [
        { nino_id: NINO_A, estado: 'activa' },
        { nino_id: NINO_B, estado: 'pendiente' },
      ]
    )
    expect(estado).toEqual({ ninosEnAlta: [NINO_B], hayNinoActivo: true })
    expect(destinoGateFamilia(estado)).toBeNull()
  })

  it('(c) hijo activo con matrícula pendiente del curso siguiente (rollover) → ni alta ni redirect', () => {
    const estado = clasificarAltaPorHijo(
      [NINO_A],
      [
        { nino_id: NINO_A, estado: 'activa' },
        { nino_id: NINO_A, estado: 'pendiente' },
      ]
    )
    expect(estado).toEqual({ ninosEnAlta: [], hayNinoActivo: true })
    expect(destinoGateFamilia(estado)).toBeNull()
  })

  it('(c bis) el orden de las filas no importa: pendiente antes que activa sigue sin ser alta', () => {
    const estado = clasificarAltaPorHijo(
      [NINO_A],
      [
        { nino_id: NINO_A, estado: 'pendiente' },
        { nino_id: NINO_A, estado: 'activa' },
      ]
    )
    expect(estado.ninosEnAlta).toEqual([])
  })

  it('(d) todos activos → nada en alta, sin redirect', () => {
    const estado = clasificarAltaPorHijo(
      [NINO_A, NINO_B],
      [
        { nino_id: NINO_A, estado: 'activa' },
        { nino_id: NINO_B, estado: 'activa' },
      ]
    )
    expect(estado).toEqual({ ninosEnAlta: [], hayNinoActivo: true })
    expect(destinoGateFamilia(estado)).toBeNull()
  })

  it('dos hijos pendientes y ninguno activo → redirige al primero', () => {
    const estado = clasificarAltaPorHijo(
      [NINO_A, NINO_B],
      [
        { nino_id: NINO_B, estado: 'pendiente' },
        { nino_id: NINO_A, estado: 'pendiente' },
      ]
    )
    expect(estado.ninosEnAlta).toEqual([NINO_A, NINO_B])
    expect(destinoGateFamilia(estado)).toBe(NINO_A)
  })

  it('hijo sin ninguna matrícula vigente → ni activo ni en alta (sin gate)', () => {
    const estado = clasificarAltaPorHijo([NINO_A], [])
    expect(estado).toEqual({ ninosEnAlta: [], hayNinoActivo: false })
    expect(destinoGateFamilia(estado)).toBeNull()
  })
})

describe('estadoAltaFamilia (lectura de BD)', () => {
  beforeEach(() => {
    filtros.length = 0
    user = { id: USER }
    vinculosRows = []
    matriculasRows = []
  })

  it('sin sesión → sin alta', async () => {
    user = null
    expect(await estadoAltaFamilia()).toEqual({ ninosEnAlta: [], hayNinoActivo: false })
  })

  it('sin vínculos de tutor legal (admin / autorizado) → sin alta y no consulta matrículas', async () => {
    expect(await estadoAltaFamilia()).toEqual({ ninosEnAlta: [], hayNinoActivo: false })
    expect(filtros.some(([t]) => t === 'matriculas')).toBe(false)
  })

  it('solo vínculos tutor_legal_* vivos y matrículas vigentes; clasifica por hijo', async () => {
    vinculosRows = [{ nino_id: NINO_A }, { nino_id: NINO_B }]
    matriculasRows = [
      { nino_id: NINO_A, estado: 'activa' },
      { nino_id: NINO_B, estado: 'pendiente' },
    ]
    expect(await estadoAltaFamilia()).toEqual({ ninosEnAlta: [NINO_B], hayNinoActivo: true })
    expect(filtros).toEqual(
      expect.arrayContaining([
        ['vinculos_familiares', 'eq:usuario_id', USER],
        [
          'vinculos_familiares',
          'in:tipo_vinculo',
          ['tutor_legal_principal', 'tutor_legal_secundario'],
        ],
        ['vinculos_familiares', 'is:deleted_at', null],
        ['matriculas', 'in:nino_id', [NINO_A, NINO_B]],
        ['matriculas', 'is:fecha_baja', null],
        ['matriculas', 'is:deleted_at', null],
      ])
    )
  })
})
