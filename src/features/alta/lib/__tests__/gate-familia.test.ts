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
const NINO_C = '44444444-4444-4444-8444-444444444444'
const CENTRO = '55555555-5555-4555-8555-555555555555'

type Hijo = { id: string; tipoVinculo: string }
let hijosDelAmbito: Hijo[]
let matriculasRows: Array<{ nino_id: string; estado: string }>
const ambitosPedidos: string[] = []
const filtros: Array<[string, string, unknown]> = []

function builder(table: string) {
  const b = {
    select: () => b,
    eq: (col: string, val: unknown) => (filtros.push([table, `eq:${col}`, val]), b),
    in: (col: string, val: unknown) => (filtros.push([table, `in:${col}`, val]), b),
    is: (col: string, val: unknown) => (filtros.push([table, `is:${col}`, val]), b),
    then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
      resolve({ data: matriculasRows, error: null }),
  }
  return b
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: (table: string) => builder(table) }),
}))

// Los hijos del centro activo los da el módulo de contexto (multicentro · Fase 2); su
// consulta se prueba contra la BD en `ambito-familiar.rls.test.ts`. Aquí, el gate.
vi.mock('@/features/centros/contexto/ambito-familiar', () => ({
  ambitoFamiliar: async (centroId: string) => {
    ambitosPedidos.push(centroId)
    return { centroId, hijos: hijosDelAmbito }
  },
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

describe('estadoAltaFamilia (hijos del centro activo + matrículas)', () => {
  beforeEach(() => {
    filtros.length = 0
    ambitosPedidos.length = 0
    hijosDelAmbito = []
    matriculasRows = []
  })

  it('pide el ámbito del centro que recibe', async () => {
    await estadoAltaFamilia(CENTRO)
    expect(ambitosPedidos).toEqual([CENTRO])
  })

  it('sin hijos en el centro (sin sesión, admin) → sin alta y no consulta matrículas', async () => {
    expect(await estadoAltaFamilia(CENTRO)).toEqual({ ninosEnAlta: [], hayNinoActivo: false })
    expect(filtros.some(([t]) => t === 'matriculas')).toBe(false)
  })

  it('solo autorizado en el centro → sin alta y no consulta matrículas', async () => {
    hijosDelAmbito = [{ id: NINO_C, tipoVinculo: 'autorizado' }]
    expect(await estadoAltaFamilia(CENTRO)).toEqual({ ninosEnAlta: [], hayNinoActivo: false })
    expect(filtros.some(([t]) => t === 'matriculas')).toBe(false)
  })

  it('solo hijos tutor_legal_* del ámbito y matrículas vigentes; clasifica por hijo', async () => {
    hijosDelAmbito = [
      { id: NINO_A, tipoVinculo: 'tutor_legal_principal' },
      { id: NINO_B, tipoVinculo: 'tutor_legal_secundario' },
      { id: NINO_C, tipoVinculo: 'autorizado' },
    ]
    matriculasRows = [
      { nino_id: NINO_A, estado: 'activa' },
      { nino_id: NINO_B, estado: 'pendiente' },
    ]
    expect(await estadoAltaFamilia(CENTRO)).toEqual({ ninosEnAlta: [NINO_B], hayNinoActivo: true })
    expect(filtros).toEqual([
      ['matriculas', 'in:nino_id', [NINO_A, NINO_B]],
      ['matriculas', 'is:fecha_baja', null],
      ['matriculas', 'is:deleted_at', null],
    ])
  })
})
