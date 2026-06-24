import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { getAulasConPersonalCore } from '../get-aulas-con-personal'

/**
 * Tests unitarios de `getAulasConPersonalCore` (F5B-#34 B2).
 *
 * Patrón idéntico al de `get-vinculos-tutores-aula.test.ts`: inyectamos un
 * SupabaseClient falso por tabla y verificamos la agregación TS.
 *
 * Cobertura (sección 9 de la spec):
 *  - Aula vacía (sin matriculas, sin profes) → contadores en 0 y arrays vacíos.
 *  - 1 coordinadora + 2 profesoras + 1 técnico + 1 apoyo → buckets y orden.
 *  - num_alumnos refleja solo matriculas activas (el mock devuelve solo activas,
 *    igual que haría la BD con `.is('fecha_baja', null)`).
 *  - Agregación correcta sobre 2 aulas distintas en el mismo curso.
 *  - Curso sin aulas → retorna [].
 */

const CURSO_ID = '00000000-0000-0000-0000-0000000000c0'

interface FakeAula {
  id: string
  centro_id: string
  nombre: string
  cohorte_anos_nacimiento: number[]
  capacidad_maxima: number
  descripcion: string | null
}

interface FakeMatricula {
  aula_id: string
}

interface FakeProfe {
  aula_id: string
  tipo_personal_aula: 'coordinadora' | 'profesora' | 'tecnico' | 'apoyo'
  profe: { id: string; nombre_completo: string } | null
}

interface FakeSetup {
  aulas: FakeAula[]
  aulasErr?: { message: string } | null
  matriculas: FakeMatricula[]
  matriculasErr?: { message: string } | null
  profes: FakeProfe[]
  profesErr?: { message: string } | null
}

function makeClient(setup: FakeSetup): SupabaseClient<Database> {
  // F11-H: getAulasPorCursoCore lee `aulas_curso` (join a `aulas`) en vez de
  // `aulas` con columnas de curso. El fake traduce cada FakeAula a la forma del
  // join (aula_id + tramo_edad/capacidad + aula embebida).
  const aulasCursoRows = setup.aulas.map((a) => ({
    aula_id: a.id,
    tramo_edad: a.cohorte_anos_nacimiento,
    capacidad: a.capacidad_maxima,
    aula: {
      centro_id: a.centro_id,
      nombre: a.nombre,
      descripcion: a.descripcion,
      deleted_at: null,
    },
  }))
  const fake = {
    from: (table: string) => {
      if (table === 'aulas_curso') {
        return chain({ data: aulasCursoRows, error: setup.aulasErr ?? null })
      }
      if (table === 'matriculas') {
        return chain({ data: setup.matriculas, error: setup.matriculasErr ?? null })
      }
      if (table === 'profes_aulas') {
        return chain({ data: setup.profes, error: setup.profesErr ?? null })
      }
      throw new Error(`unexpected table: ${table}`)
    },
  } as unknown as SupabaseClient<Database>
  return fake
}

function chain<T>(result: { data: T; error: { message: string } | null }) {
  const promise = Promise.resolve(result)
  const proxy: Record<string, unknown> = {}
  for (const m of ['select', 'in', 'eq', 'is', 'order', 'limit']) {
    proxy[m] = (..._args: unknown[]) => proxy
  }
  proxy.then = (resolve: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) =>
    promise.then(resolve, reject)
  return proxy
}

function makeAula(id: string, nombre: string): FakeAula {
  return {
    id,
    centro_id: 'centro-1',
    nombre,
    cohorte_anos_nacimiento: [2024],
    capacidad_maxima: 12,
    descripcion: null,
  }
}

describe('getAulasConPersonalCore', () => {
  it('aula sin matriculas ni personal → num_alumnos=0 y arrays vacíos', async () => {
    const client = makeClient({
      aulas: [makeAula('a1', 'Aula A')],
      matriculas: [],
      profes: [],
    })

    const result = await getAulasConPersonalCore(client, CURSO_ID)
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('a1')
    expect(result[0]!.num_alumnos).toBe(0)
    expect(result[0]!.profesoras).toEqual([])
    expect(result[0]!.tecnicos).toEqual([])
    expect(result[0]!.apoyos).toEqual([])
  })

  it('1 coordinadora + 2 profesoras + 1 técnico + 1 apoyo: buckets y orden correctos', async () => {
    const client = makeClient({
      aulas: [makeAula('a1', 'Aula A')],
      matriculas: [{ aula_id: 'a1' }, { aula_id: 'a1' }, { aula_id: 'a1' }],
      profes: [
        {
          aula_id: 'a1',
          tipo_personal_aula: 'profesora',
          profe: { id: 'u-zara', nombre_completo: 'Zara' },
        },
        {
          aula_id: 'a1',
          tipo_personal_aula: 'coordinadora',
          profe: { id: 'u-coord', nombre_completo: 'Mónica' },
        },
        {
          aula_id: 'a1',
          tipo_personal_aula: 'profesora',
          profe: { id: 'u-ana', nombre_completo: 'Ana' },
        },
        {
          aula_id: 'a1',
          tipo_personal_aula: 'tecnico',
          profe: { id: 'u-tec', nombre_completo: 'Lucía' },
        },
        {
          aula_id: 'a1',
          tipo_personal_aula: 'apoyo',
          profe: { id: 'u-apo', nombre_completo: 'Sara' },
        },
      ],
    })

    const result = await getAulasConPersonalCore(client, CURSO_ID)
    expect(result[0]!.num_alumnos).toBe(3)
    expect(result[0]!.profesoras.map((p) => p.nombre_completo)).toEqual(['Mónica', 'Ana', 'Zara'])
    expect(result[0]!.profesoras[0]!.tipo_personal_aula).toBe('coordinadora')
    expect(result[0]!.tecnicos.map((p) => p.nombre_completo)).toEqual(['Lucía'])
    expect(result[0]!.apoyos.map((p) => p.nombre_completo)).toEqual(['Sara'])
  })

  it('num_alumnos cuenta solo matriculas devueltas por la query (activas)', async () => {
    // El filtro `.is('fecha_baja', null).is('deleted_at', null)` ocurre a
    // nivel de query — el mock simula que la BD ya descartó las bajas y
    // entrega solo activas. Verificamos el conteo TS.
    const client = makeClient({
      aulas: [makeAula('a1', 'Aula A')],
      matriculas: [{ aula_id: 'a1' }, { aula_id: 'a1' }],
      profes: [],
    })

    const result = await getAulasConPersonalCore(client, CURSO_ID)
    expect(result[0]!.num_alumnos).toBe(2)
  })

  it('agrega correctamente sobre múltiples aulas del mismo curso', async () => {
    const client = makeClient({
      aulas: [makeAula('a1', 'Aula A'), makeAula('a2', 'Aula B')],
      matriculas: [{ aula_id: 'a1' }, { aula_id: 'a2' }, { aula_id: 'a2' }, { aula_id: 'a2' }],
      profes: [
        {
          aula_id: 'a1',
          tipo_personal_aula: 'coordinadora',
          profe: { id: 'u1', nombre_completo: 'Ana' },
        },
        {
          aula_id: 'a2',
          tipo_personal_aula: 'tecnico',
          profe: { id: 'u2', nombre_completo: 'Bea' },
        },
        {
          aula_id: 'a2',
          tipo_personal_aula: 'profesora',
          profe: { id: 'u3', nombre_completo: 'Clara' },
        },
      ],
    })

    const result = await getAulasConPersonalCore(client, CURSO_ID)
    expect(result).toHaveLength(2)
    const a1 = result.find((a) => a.id === 'a1')!
    const a2 = result.find((a) => a.id === 'a2')!
    expect(a1.num_alumnos).toBe(1)
    expect(a1.profesoras).toHaveLength(1)
    expect(a1.tecnicos).toHaveLength(0)
    expect(a2.num_alumnos).toBe(3)
    expect(a2.profesoras).toHaveLength(1)
    expect(a2.tecnicos).toHaveLength(1)
  })

  it('curso sin aulas → []', async () => {
    const client = makeClient({ aulas: [], matriculas: [], profes: [] })
    const result = await getAulasConPersonalCore(client, CURSO_ID)
    expect(result).toEqual([])
  })

  it('error en aulas → []', async () => {
    const client = makeClient({
      aulas: [],
      aulasErr: { message: 'boom' },
      matriculas: [],
      profes: [],
    })
    const result = await getAulasConPersonalCore(client, CURSO_ID)
    expect(result).toEqual([])
  })
})
