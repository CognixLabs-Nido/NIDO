import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { getPersonalActivoCentroCore, type EmailResolver } from '../get-personal-activo-centro'

/**
 * Tests unitarios de `getPersonalActivoCentroCore` (Fallo 1 — listado de personal
 * activo). Patrón de cliente fake por tabla (igual que `get-aulas-con-personal`).
 *
 * Cobertura:
 *  - Agrupa por persona: una profe en DOS aulas → 1 fila, 2 asignaciones, sin
 *    duplicar foto/nombre/email.
 *  - Orden de asignaciones: coordinadora antes que profesora.
 *  - Email se inyecta desde el resolver (auth.users), no de la query.
 *  - Orden alfabético de personas; curso sin aulas → [].
 */

const CURSO_ID = '00000000-0000-0000-0000-0000000000c0'

interface FakeAula {
  id: string
  nombre: string
}
interface FakeProfe {
  aula_id: string
  tipo_personal_aula: 'coordinadora' | 'profesora' | 'tecnico' | 'apoyo'
  profe: { id: string; nombre_completo: string; foto_url: string | null } | null
}
interface FakeSetup {
  aulas: FakeAula[]
  aulasErr?: { message: string } | null
  profes: FakeProfe[]
  profesErr?: { message: string } | null
}

function makeClient(setup: FakeSetup): SupabaseClient<Database> {
  const fake = {
    from: (table: string) => {
      if (table === 'aulas') return chain({ data: setup.aulas, error: setup.aulasErr ?? null })
      if (table === 'profes_aulas')
        return chain({ data: setup.profes, error: setup.profesErr ?? null })
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

/** Resolver de emails fijo por id. */
const resolver =
  (map: Record<string, string>): EmailResolver =>
  async (ids) =>
    new Map(ids.filter((id) => id in map).map((id) => [id, map[id]!]))

describe('getPersonalActivoCentroCore', () => {
  it('profe en DOS aulas → 1 fila con 2 asignaciones (sin duplicar persona)', async () => {
    const client = makeClient({
      aulas: [
        { id: 'a1', nombre: 'Aula 1-2 años' },
        { id: 'a2', nombre: 'Aula 2-3 años' },
      ],
      profes: [
        {
          aula_id: 'a1',
          tipo_personal_aula: 'coordinadora',
          profe: { id: 'u-mar', nombre_completo: 'María', foto_url: 'c1/u-mar/x.jpg' },
        },
        {
          aula_id: 'a2',
          tipo_personal_aula: 'profesora',
          profe: { id: 'u-mar', nombre_completo: 'María', foto_url: 'c1/u-mar/x.jpg' },
        },
      ],
    })

    const result = await getPersonalActivoCentroCore(
      client,
      CURSO_ID,
      resolver({ 'u-mar': 'maria@anaia.test' })
    )

    expect(result).toHaveLength(1)
    const maria = result[0]!
    expect(maria.profe_id).toBe('u-mar')
    expect(maria.nombre_completo).toBe('María')
    expect(maria.email).toBe('maria@anaia.test')
    expect(maria.foto_url).toBe('c1/u-mar/x.jpg')
    // Dos asignaciones, coordinadora primero (orden por tipo).
    expect(maria.asignaciones).toHaveLength(2)
    expect(maria.asignaciones[0]).toMatchObject({
      tipo_personal_aula: 'coordinadora',
      aula_nombre: 'Aula 1-2 años',
    })
    expect(maria.asignaciones[1]).toMatchObject({
      tipo_personal_aula: 'profesora',
      aula_nombre: 'Aula 2-3 años',
    })
  })

  it('varias personas → orden alfabético; email null si el resolver no lo trae', async () => {
    const client = makeClient({
      aulas: [{ id: 'a1', nombre: 'Aula A' }],
      profes: [
        {
          aula_id: 'a1',
          tipo_personal_aula: 'profesora',
          profe: { id: 'u-zoe', nombre_completo: 'Zoe', foto_url: null },
        },
        {
          aula_id: 'a1',
          tipo_personal_aula: 'apoyo',
          profe: { id: 'u-ana', nombre_completo: 'Ana', foto_url: null },
        },
      ],
    })

    const result = await getPersonalActivoCentroCore(
      client,
      CURSO_ID,
      resolver({ 'u-ana': 'ana@anaia.test' })
    )

    expect(result.map((p) => p.nombre_completo)).toEqual(['Ana', 'Zoe'])
    expect(result.find((p) => p.profe_id === 'u-zoe')!.email).toBeNull()
    expect(result.find((p) => p.profe_id === 'u-ana')!.email).toBe('ana@anaia.test')
  })

  it('curso sin aulas → []', async () => {
    const client = makeClient({ aulas: [], profes: [] })
    const result = await getPersonalActivoCentroCore(client, CURSO_ID, resolver({}))
    expect(result).toEqual([])
  })

  it('error en profes_aulas → []', async () => {
    const client = makeClient({
      aulas: [{ id: 'a1', nombre: 'Aula A' }],
      profes: [],
      profesErr: { message: 'boom' },
    })
    const result = await getPersonalActivoCentroCore(client, CURSO_ID, resolver({}))
    expect(result).toEqual([])
  })
})
