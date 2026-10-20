import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  centrosDondeEsAdmin,
  esAdminEn,
  esSuperusuario,
  leerCentrosDe,
  rolesEnCentro,
  rolesEnCualquierCentro,
} from '../roles-del-usuario'

/**
 * La lectura de roles con cliente inyectado (la de los núcleos de las acciones). Usuario con roles
 * en DOS centros: admin en A, tutor y profe en B. Nada elige un centro: o se pasa explícito o se
 * devuelve la lista entera, ordenada por id.
 */

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const USUARIO = '11111111-1111-4111-8111-111111111111'

/**
 * `superusuario`: lo que responde `is_superadmin` (por defecto, que no). `centros`: los centros
 * que existen (solo los lee el superusuario).
 */
function fake(
  resp: { data: unknown; error: unknown },
  opciones: {
    superusuario?: { data: unknown; error: unknown }
    centros?: { data: unknown; error: unknown }
  } = {}
) {
  const filtros: Array<[string, unknown]> = []
  const tablas: string[] = []
  const rpcs: string[] = []
  const builder = (r: { data: unknown; error: unknown }) => {
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.eq = (col: string, v: unknown) => {
      filtros.push([col, v])
      return b
    }
    b.is = (col: string, v: unknown) => {
      filtros.push([col, v])
      return b
    }
    b.then = (resolve: (v: unknown) => unknown) => resolve(r)
    return b
  }
  const client = {
    from: (tabla: string) => {
      tablas.push(tabla)
      return builder(tabla === 'centros' ? (opciones.centros ?? { data: [], error: null }) : resp)
    },
    rpc: async (fn: string) => {
      rpcs.push(fn)
      return opciones.superusuario ?? { data: false, error: null }
    },
  } as unknown as SupabaseClient<Database>
  return { client, filtros, tablas, rpcs }
}

const DOS_CENTROS = {
  data: [
    { centro_id: B, rol: 'tutor_legal' },
    { centro_id: A, rol: 'admin' },
    { centro_id: B, rol: 'profe' },
  ],
  error: null,
}

describe('roles-del-usuario (cliente inyectado)', () => {
  it('lee SOLO los roles activos del usuario dado', async () => {
    const { client, filtros } = fake(DOS_CENTROS)
    await leerCentrosDe(client, USUARIO)
    expect(filtros).toEqual([
      ['usuario_id', USUARIO],
      ['deleted_at', null],
    ])
  })

  it('agrupa por centro, ordenado por id, con el rol principal de cada uno', async () => {
    const { client } = fake(DOS_CENTROS)
    expect(await leerCentrosDe(client, USUARIO)).toEqual([
      { centroId: A, rol: 'admin', roles: ['admin'] },
      { centroId: B, rol: 'profe', roles: ['profe', 'tutor_legal'] },
    ])
  })

  it('rolesEnCentro: el centro EXPLÍCITO; uno ajeno → null', async () => {
    const { client } = fake(DOS_CENTROS)
    expect(await rolesEnCentro(client, USUARIO, B)).toMatchObject({ centroId: B, rol: 'profe' })
    expect(await rolesEnCentro(client, USUARIO, C)).toBeNull()
  })

  it('esAdminEn: sí en A, no en B (aunque sea admin en otro centro)', async () => {
    const { client } = fake(DOS_CENTROS)
    expect(await esAdminEn(client, USUARIO, A)).toBe(true)
    expect(await esAdminEn(client, USUARIO, B)).toBe(false)
  })

  it('centrosDondeEsAdmin: solo A', async () => {
    const { client } = fake(DOS_CENTROS)
    expect(await centrosDondeEsAdmin(client, USUARIO)).toEqual([A])
  })

  it('un fallo de lectura es null (no «sin roles»), y esAdminEn lo cuenta como «no»', async () => {
    const { client } = fake({ data: null, error: { message: 'boom' } })
    expect(await leerCentrosDe(client, USUARIO)).toBeNull()
    expect(await centrosDondeEsAdmin(client, USUARIO)).toBeNull()
    expect(await esAdminEn(client, USUARIO, A)).toBe(false)
  })
})

describe('superusuario (Fase 3)', () => {
  const SUPER = { data: true, error: null }
  const EXISTEN = { data: [{ id: C }, { id: A }, { id: B }], error: null }

  it('leerCentrosDe: todos los centros que existen, como admin, sumando sus roles propios', async () => {
    const { client, tablas } = fake(DOS_CENTROS, { superusuario: SUPER, centros: EXISTEN })
    expect(await leerCentrosDe(client, USUARIO)).toEqual([
      { centroId: A, rol: 'admin', roles: ['admin'] },
      { centroId: B, rol: 'admin', roles: ['admin', 'profe', 'tutor_legal'] },
      { centroId: C, rol: 'admin', roles: ['admin'] },
    ])
    expect(tablas).toContain('centros')
    expect(await esAdminEn(client, USUARIO, C)).toBe(true)
    expect(await centrosDondeEsAdmin(client, USUARIO)).toEqual([A, B, C])
  })

  it('un usuario normal no lee los centros: solo los suyos', async () => {
    const { client, tablas, rpcs } = fake(DOS_CENTROS)
    expect(await esAdminEn(client, USUARIO, C)).toBe(false)
    expect(rpcs).toContain('is_superadmin')
    expect(tablas).not.toContain('centros')
  })

  it('si is_superadmin falla, NO es superusuario (nunca abre de más)', async () => {
    const { client } = fake(DOS_CENTROS, {
      superusuario: { data: null, error: { message: 'boom', code: 'XX000' } },
      centros: EXISTEN,
    })
    expect(await esSuperusuario(client)).toBe(false)
    expect(await esAdminEn(client, USUARIO, C)).toBe(false)
  })

  it('si falla la lectura de los centros, null (como un fallo de roles)', async () => {
    const { client } = fake(DOS_CENTROS, {
      superusuario: SUPER,
      centros: { data: null, error: { message: 'boom' } },
    })
    expect(await leerCentrosDe(client, USUARIO)).toBeNull()
  })

  it('rolesEnCualquierCentro (proxy): el superusuario suma admin; el normal, no', async () => {
    const soloTutor = { data: [{ rol: 'tutor_legal' }], error: null }
    expect(
      await rolesEnCualquierCentro(fake(soloTutor, { superusuario: SUPER }).client, USUARIO)
    ).toEqual(['tutor_legal', 'admin'])
    expect(
      await rolesEnCualquierCentro(
        fake({ data: [], error: null }, { superusuario: SUPER }).client,
        USUARIO
      )
    ).toEqual(['admin'])
    expect(await rolesEnCualquierCentro(fake(soloTutor).client, USUARIO)).toEqual(['tutor_legal'])
  })
})
