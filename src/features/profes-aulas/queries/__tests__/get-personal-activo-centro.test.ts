import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  getPersonalActivoCentroCore,
  resolverEmailsPorId,
  type EmailResolver,
} from '../get-personal-activo-centro'

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
  // F11-H: las aulas del curso salen de `aulas_curso` (join a `aulas`).
  const aulasCursoRows = setup.aulas.map((a) => ({
    aula_id: a.id,
    aula: { nombre: a.nombre, deleted_at: null },
  }))
  const fake = {
    from: (table: string) => {
      if (table === 'aulas_curso')
        return chain({ data: aulasCursoRows, error: setup.aulasErr ?? null })
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
          profe: { id: 'u-mar', nombre_completo: 'María', foto_url: 'u-mar/x.jpg' },
        },
        {
          aula_id: 'a2',
          tipo_personal_aula: 'profesora',
          profe: { id: 'u-mar', nombre_completo: 'María', foto_url: 'u-mar/x.jpg' },
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
    expect(maria.foto_url).toBe('u-mar/x.jpg')
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

/**
 * `resolverEmailsPorId`: email por id con `getUserById` (lectura exacta), no con
 * `listUsers({ page: 1, perPage: 1000 })`, que dejaba sin email al personal que cayera más
 * allá de la 1.ª página. El fake solo define `getUserById`: si se llamara a `listUsers`,
 * el test reventaría.
 */
describe('resolverEmailsPorId', () => {
  type Auth = Pick<SupabaseClient<Database>, 'auth'>
  function fakeAuth(usuarios: Record<string, string>, falla: string[] = []) {
    const pedidos: string[] = []
    const service = {
      auth: {
        admin: {
          getUserById: async (id: string) => {
            pedidos.push(id)
            if (falla.includes(id)) throw new Error('fetch failed')
            const email = usuarios[id]
            return email
              ? { data: { user: { id, email } }, error: null }
              : { data: { user: null }, error: { message: 'User not found' } }
          },
        },
      },
    } as unknown as Auth
    return { service, pedidos }
  }

  it('resuelve cada id por su propia lectura y devuelve su email', async () => {
    const { service, pedidos } = fakeAuth({ p1: 'p1@correo.test', p2: 'p2@correo.test' })
    const map = await resolverEmailsPorId(service, ['p1', 'p2'])
    expect([...map.entries()]).toEqual([
      ['p1', 'p1@correo.test'],
      ['p2', 'p2@correo.test'],
    ])
    expect(pedidos.sort()).toEqual(['p1', 'p2'])
  })

  it('no depende de cuántas cuentas haya: un id cualquiera se encuentra igual', async () => {
    // Con listUsers({ perPage: 1000 }), la cuenta 1001 no salía. Aquí no hay página.
    const usuarios = Object.fromEntries(
      Array.from({ length: 1500 }, (_, i) => [`u${i}`, `u${i}@correo.test`])
    )
    const { service } = fakeAuth(usuarios)
    const map = await resolverEmailsPorId(service, ['u1200'])
    expect(map.get('u1200')).toBe('u1200@correo.test')
  })

  it('un id sin cuenta o una llamada que falla deja a esa persona sin email, no rompe', async () => {
    const { service } = fakeAuth({ p1: 'p1@correo.test' }, ['p3'])
    const map = await resolverEmailsPorId(service, ['p1', 'p2', 'p3'])
    expect([...map.keys()]).toEqual(['p1'])
  })

  it('sin ids no llama a nada; un id repetido se pide una vez', async () => {
    const vacio = fakeAuth({})
    expect((await resolverEmailsPorId(vacio.service, [])).size).toBe(0)
    expect(vacio.pedidos).toEqual([])
    const rep = fakeAuth({ p1: 'p1@correo.test' })
    await resolverEmailsPorId(rep.service, ['p1', 'p1'])
    expect(rep.pedidos).toEqual(['p1'])
  })
})
