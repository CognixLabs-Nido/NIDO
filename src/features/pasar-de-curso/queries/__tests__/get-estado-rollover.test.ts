import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import { esLecturaFallida } from '@/shared/lib/lectura-fallida'
import type { Database } from '@/types/db'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

const { getEstadoRolloverCore } = await import('../get-estado-rollover')

/**
 * Censo C (re-clasificación 168 y los F1/F2 de get-estado-rollover, 2026-11-26): el estado del pase de curso decide
 * qué matrículas propone `proponerMatriculas` y si `confirmarRollover` da el curso por completo. Una lectura caída
 * era «Curso destino no encontrado» o una lista vacía. Ahora cada una lanza `LecturaFallida`, y las acciones lo
 * convierten en «no se pudo leer» (`falloDeLectura`).
 */
const DESTINO = '11111111-1111-4111-8111-111111111111'
const ORIGEN = '22222222-2222-4222-8222-222222222222'
const CENTRO = '33333333-3333-4333-8333-333333333333'
const AULA = '44444444-4444-4444-8444-444444444444'

type Paso =
  | 'destino'
  | 'origen'
  | 'aulas_destino'
  | 'ninos_activos'
  | 'nombres_aula'
  | 'pendientes'
  | 'finaliza'

// Las lecturas, en el orden en que las hace la consulta, con lo que contesta cada una si va bien.
const BIEN: Record<Paso, unknown> = {
  destino: { id: DESTINO, nombre: '2027-28', estado: 'planificado', centro_id: CENTRO },
  origen: { id: ORIGEN, nombre: '2026-27' },
  aulas_destino: [
    { aula_id: AULA, tramo_edad: [2025], capacidad: 10, aula: { nombre: 'Sol', deleted_at: null } },
  ],
  ninos_activos: [
    {
      aula_id: AULA,
      nino: {
        id: 'n1',
        nombre: 'Niño Demo 1',
        apellidos: null,
        fecha_nacimiento: '2025-01-01',
        deleted_at: null,
      },
    },
  ],
  nombres_aula: [{ id: AULA, nombre: 'Sol' }],
  pendientes: [{ nino_id: 'n1', aula_id: AULA }],
  finaliza: [],
}
const ORDEN: Paso[] = [
  'destino',
  'origen',
  'aulas_destino',
  'ninos_activos',
  'nombres_aula',
  'pendientes',
  'finaliza',
]

function cliente(falla: Paso | null, sinDestino = false) {
  let i = 0
  const from = () => {
    const paso = ORDEN[i++]!
    const r =
      paso === falla
        ? { data: null, error: { code: 'XX000', message: `caída: ${paso}` } }
        : { data: paso === 'destino' && sinDestino ? null : BIEN[paso], error: null }
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'in']) b[m] = () => b
    b.maybeSingle = () => Promise.resolve(r)
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(r).then(ok, ko)
    return b
  }
  return { from } as unknown as SupabaseClient<Database>
}

describe('getEstadoRolloverCore · una lectura caída no es «no hay»', () => {
  it('control: todo bien → el estado, con sus pendientes', async () => {
    const e = await getEstadoRolloverCore(cliente(null), DESTINO)
    expect(e?.cursoOrigen).toEqual({ id: ORIGEN, nombre: '2026-27' })
    expect(e?.pendientes).toEqual([{ nino_id: 'n1', aula_id: AULA }])
    expect(e?.ninosActivos.map((n) => n.aula_origen_nombre)).toEqual(['Sol'])
  })

  it('el destino que no existe (sin error) → null', async () => {
    expect(await getEstadoRolloverCore(cliente(null, true), DESTINO)).toBeNull()
  })

  for (const paso of ORDEN) {
    it(`si falla ${paso} → LecturaFallida, no null ni una lista vacía`, async () => {
      const e = await getEstadoRolloverCore(cliente(paso), DESTINO).then(
        () => null,
        (x: unknown) => x
      )
      expect(esLecturaFallida(e), String(e)).toBe(true)
    })
  }
})
