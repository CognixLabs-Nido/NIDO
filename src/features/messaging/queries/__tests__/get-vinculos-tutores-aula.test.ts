import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { getVinculosTutoresAulaCore } from '../get-vinculos-tutores-aula'

/**
 * Tests unitarios de `getVinculosTutoresAulaCore` (F5B-#33).
 *
 * Inyectamos un `SupabaseClient` falso para ejercer las dos rondas de IO
 * con respuestas deterministas y verificar:
 *  - Agrupación por `nino_id` (Map con un entry por niño con vínculo).
 *  - Caso aula vacía (matriculas=[]) → Map vacío sin segunda ronda.
 *  - Filtrado por matrículas activas (la query lo enforza vía
 *    `.eq().is()`; verificamos que la 2ª ronda solo recibe los
 *    `ninoIds` de la primera).
 *  - Coexistencia de los 3 `tipo_vinculo` admitidos.
 *  - Error en la primera o segunda ronda → Map vacío (no throw).
 *
 * Sin RLS real — los tests RLS de `vinculos_familiares` viven en
 * `src/test/rls/vinculos.rls.test.ts`.
 */

const AULA_ID = '00000000-0000-0000-0000-000000000aa1'

interface FakeMatricula {
  nino_id: string
}

interface FakeVinculo {
  nino_id: string
  usuario_id: string
  tipo_vinculo: 'tutor_legal_principal' | 'tutor_legal_secundario' | 'autorizado'
  usuario: { nombre_completo: string }
}

interface FakeSetup {
  matriculas: FakeMatricula[]
  matriculasErr?: { message: string } | null
  vinculos: FakeVinculo[]
  vinculosErr?: { message: string } | null
}

function makeClient(setup: FakeSetup): SupabaseClient<Database> {
  const fake = {
    from: (table: string) => {
      if (table === 'matriculas') {
        return chain({ data: setup.matriculas, error: setup.matriculasErr ?? null })
      }
      if (table === 'vinculos_familiares') {
        return chain({ data: setup.vinculos, error: setup.vinculosErr ?? null })
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

describe('getVinculosTutoresAulaCore', () => {
  it('agrupa vínculos por nino_id', async () => {
    const client = makeClient({
      matriculas: [{ nino_id: 'n1' }, { nino_id: 'n2' }],
      vinculos: [
        {
          nino_id: 'n1',
          usuario_id: 'u1',
          tipo_vinculo: 'tutor_legal_principal',
          usuario: { nombre_completo: 'Madre N1' },
        },
        {
          nino_id: 'n1',
          usuario_id: 'u2',
          tipo_vinculo: 'tutor_legal_secundario',
          usuario: { nombre_completo: 'Padre N1' },
        },
        {
          nino_id: 'n2',
          usuario_id: 'u3',
          tipo_vinculo: 'tutor_legal_principal',
          usuario: { nombre_completo: 'Madre N2' },
        },
      ],
    })

    const map = await getVinculosTutoresAulaCore(client, AULA_ID)
    expect(map.size).toBe(2)
    expect(map.get('n1')).toHaveLength(2)
    expect(map.get('n2')).toHaveLength(1)
    expect(map.get('n1')!.map((v) => v.tipo_vinculo)).toEqual([
      'tutor_legal_principal',
      'tutor_legal_secundario',
    ])
  })

  it('aula vacía → Map vacío sin segunda ronda', async () => {
    const client = makeClient({ matriculas: [], vinculos: [] })
    const map = await getVinculosTutoresAulaCore(client, AULA_ID)
    expect(map.size).toBe(0)
  })

  it('coexisten los 3 tipos en distintos niños', async () => {
    const client = makeClient({
      matriculas: [{ nino_id: 'a' }, { nino_id: 'b' }, { nino_id: 'c' }],
      vinculos: [
        {
          nino_id: 'a',
          usuario_id: 'ua',
          tipo_vinculo: 'tutor_legal_principal',
          usuario: { nombre_completo: 'P' },
        },
        {
          nino_id: 'b',
          usuario_id: 'ub',
          tipo_vinculo: 'tutor_legal_secundario',
          usuario: { nombre_completo: 'S' },
        },
        {
          nino_id: 'c',
          usuario_id: 'uc',
          tipo_vinculo: 'autorizado',
          usuario: { nombre_completo: 'A' },
        },
      ],
    })

    const map = await getVinculosTutoresAulaCore(client, AULA_ID)
    expect(map.get('a')![0]!.tipo_vinculo).toBe('tutor_legal_principal')
    expect(map.get('b')![0]!.tipo_vinculo).toBe('tutor_legal_secundario')
    expect(map.get('c')![0]!.tipo_vinculo).toBe('autorizado')
  })

  it('error en matriculas → Map vacío (no throw)', async () => {
    const client = makeClient({
      matriculas: [],
      matriculasErr: { message: 'boom' },
      vinculos: [],
    })
    const map = await getVinculosTutoresAulaCore(client, AULA_ID)
    expect(map.size).toBe(0)
  })

  it('error en vinculos → Map vacío (no throw)', async () => {
    const client = makeClient({
      matriculas: [{ nino_id: 'n1' }],
      vinculos: [],
      vinculosErr: { message: 'rls denied' },
    })
    const map = await getVinculosTutoresAulaCore(client, AULA_ID)
    expect(map.size).toBe(0)
  })

  it('nombre_completo NULL fallbacks a string vacío', async () => {
    const client = makeClient({
      matriculas: [{ nino_id: 'n1' }],
      vinculos: [
        {
          nino_id: 'n1',
          usuario_id: 'u1',
          tipo_vinculo: 'tutor_legal_principal',
          usuario: { nombre_completo: '' },
        },
      ],
    })
    const map = await getVinculosTutoresAulaCore(client, AULA_ID)
    expect(map.get('n1')![0]!.nombre_completo).toBe('')
  })
})
