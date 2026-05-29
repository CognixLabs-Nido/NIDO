import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { getTutoresParaAdminDireccionCore } from '../get-tutores-para-admin-direccion'

/**
 * Tests unitarios de `getTutoresParaAdminDireccionCore` (F5B-Items1+2).
 *
 * Inyectamos un `SupabaseClient` falso para ejercer las 3 rondas de IO
 * con respuestas deterministas y verificar:
 *  - Dedup por usuario_id (tutor con varios hijos del centro → 1 row).
 *  - Filtrado por centro (vínculos sobre niños de otro centro no aparecen).
 *  - Filtrado por soft-delete del niño.
 *  - Composición correcta con/sin hilo existente.
 *  - Ordenación: con hilo activo (last_message_at desc) → con hilo vacío
 *    (expires_at desc) → sin hilo (alfabético).
 *  - `unread_count` ignora mensajes propios y anulados.
 *  - `last_message_preview` queda en null si el último mensaje es anulado.
 *
 * Sin RLS real — los tests de RLS contra Supabase local viven en
 * `src/test/rls/messaging.rls.test.ts`.
 */

const USER_ID = '00000000-0000-0000-0000-000000000aaa'
const CENTRO_A = '00000000-0000-0000-0000-000000000001'
const CENTRO_B = '00000000-0000-0000-0000-000000000002'

interface FakeVinculo {
  usuario_id: string
  usuario: { nombre_completo: string }
  nino: {
    id: string
    nombre: string
    apellidos: string
    centro_id: string
    deleted_at: string | null
  }
}

interface FakeConv {
  id: string
  tutor_id: string
  expires_at: string
  last_message_at: string | null
}

interface FakeMsg {
  conversacion_id: string
  contenido: string
  erroneo: boolean
  created_at: string
  autor_id: string
}

interface FakeLectura {
  conversacion_id: string
  last_read_at: string
}

interface FakeSetup {
  vinculos: FakeVinculo[]
  convs: FakeConv[]
  msgs: FakeMsg[]
  lecturas: FakeLectura[]
}

function makeClient(setup: FakeSetup): SupabaseClient<Database> {
  const fake = {
    from: (table: string) => {
      if (table === 'vinculos_familiares') {
        return chain({ data: setup.vinculos, error: null })
      }
      if (table === 'conversaciones') {
        return chain({ data: setup.convs, error: null })
      }
      if (table === 'mensajes') {
        return chain({ data: setup.msgs, error: null })
      }
      if (table === 'lectura_conversacion') {
        return chain({ data: setup.lecturas, error: null })
      }
      throw new Error(`unexpected table: ${table}`)
    },
  } as unknown as SupabaseClient<Database>
  return fake
}

/** Devuelve un builder encadenable que resuelve a `result` al esperar await.
 *  Coincide con los pocos métodos que la query encadena: select, in, eq, is,
 *  order, limit, sin importar el orden. */
function chain<T>(result: { data: T; error: null }) {
  const promise = Promise.resolve(result)
  const proxy: Record<string, unknown> = {}
  const methods = ['select', 'in', 'eq', 'is', 'order', 'limit']
  for (const m of methods) {
    proxy[m] = (..._args: unknown[]) => proxy
  }
  proxy.then = (resolve: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) =>
    promise.then(resolve, reject)
  return proxy
}

describe('getTutoresParaAdminDireccionCore', () => {
  it('dedup por usuario_id: tutor con 2 hijos del centro aparece una vez con hijos[]', async () => {
    const tutorId = '00000000-0000-0000-0000-000000000010'
    const client = makeClient({
      vinculos: [
        {
          usuario_id: tutorId,
          usuario: { nombre_completo: 'Marisol Pérez' },
          nino: {
            id: 'n1',
            nombre: 'Lucas',
            apellidos: 'Pérez García',
            centro_id: CENTRO_A,
            deleted_at: null,
          },
        },
        {
          usuario_id: tutorId,
          usuario: { nombre_completo: 'Marisol Pérez' },
          nino: {
            id: 'n2',
            nombre: 'Ana',
            apellidos: 'Pérez García',
            centro_id: CENTRO_A,
            deleted_at: null,
          },
        },
      ],
      convs: [],
      msgs: [],
      lecturas: [],
    })

    const items = await getTutoresParaAdminDireccionCore(client, USER_ID, CENTRO_A)
    expect(items).toHaveLength(1)
    expect(items[0]!.usuario_id).toBe(tutorId)
    expect(items[0]!.hijos).toHaveLength(2)
    // Hijos ordenados alfabéticamente
    expect(items[0]!.hijos.map((h) => h.nombre)).toEqual(['Ana', 'Lucas'])
  })

  it('filtra por centro: tutor con hijos en otro centro no aparece para admin de CENTRO_A', async () => {
    const client = makeClient({
      vinculos: [
        {
          usuario_id: '00000000-0000-0000-0000-000000000020',
          usuario: { nombre_completo: 'Carmen B' },
          nino: {
            id: 'nb',
            nombre: 'Niño B',
            apellidos: '—',
            centro_id: CENTRO_B,
            deleted_at: null,
          },
        },
      ],
      convs: [],
      msgs: [],
      lecturas: [],
    })

    const items = await getTutoresParaAdminDireccionCore(client, USER_ID, CENTRO_A)
    expect(items).toHaveLength(0)
  })

  it('ignora niños soft-deleted', async () => {
    const client = makeClient({
      vinculos: [
        {
          usuario_id: '00000000-0000-0000-0000-000000000030',
          usuario: { nombre_completo: 'Tutor X' },
          nino: {
            id: 'nx',
            nombre: 'Borrado',
            apellidos: '—',
            centro_id: CENTRO_A,
            deleted_at: '2026-01-01T00:00:00Z',
          },
        },
      ],
      convs: [],
      msgs: [],
      lecturas: [],
    })

    const items = await getTutoresParaAdminDireccionCore(client, USER_ID, CENTRO_A)
    expect(items).toHaveLength(0)
  })

  it('ordenación: con-hilo-activo desc → con-hilo-vacío expires desc → sin-hilo alfabético', async () => {
    const ahora = new Date('2026-05-29T10:00:00Z').toISOString()
    const hace1h = new Date('2026-05-29T09:00:00Z').toISOString()
    const expiresAlto = new Date('2026-06-01T00:00:00Z').toISOString()
    const expiresBajo = new Date('2026-05-30T00:00:00Z').toISOString()

    const client = makeClient({
      vinculos: [
        // ZZZ — sin hilo, va al final alfabéticamente
        {
          usuario_id: '00000000-0000-0000-0000-000000000040',
          usuario: { nombre_completo: 'ZZZ Último' },
          nino: {
            id: 'n40',
            nombre: 'NA',
            apellidos: '',
            centro_id: CENTRO_A,
            deleted_at: null,
          },
        },
        // AAA — hilo activo + mensaje hace 1h
        {
          usuario_id: '00000000-0000-0000-0000-000000000041',
          usuario: { nombre_completo: 'AAA Primero' },
          nino: {
            id: 'n41',
            nombre: 'NB',
            apellidos: '',
            centro_id: CENTRO_A,
            deleted_at: null,
          },
        },
        // BBB — hilo activo + mensaje AHORA (más reciente que AAA)
        {
          usuario_id: '00000000-0000-0000-0000-000000000042',
          usuario: { nombre_completo: 'BBB Segundo' },
          nino: {
            id: 'n42',
            nombre: 'NC',
            apellidos: '',
            centro_id: CENTRO_A,
            deleted_at: null,
          },
        },
        // CCC — hilo vacío con expires alto
        {
          usuario_id: '00000000-0000-0000-0000-000000000043',
          usuario: { nombre_completo: 'CCC Vacío Alto' },
          nino: {
            id: 'n43',
            nombre: 'ND',
            apellidos: '',
            centro_id: CENTRO_A,
            deleted_at: null,
          },
        },
        // DDD — hilo vacío con expires bajo
        {
          usuario_id: '00000000-0000-0000-0000-000000000044',
          usuario: { nombre_completo: 'DDD Vacío Bajo' },
          nino: {
            id: 'n44',
            nombre: 'NE',
            apellidos: '',
            centro_id: CENTRO_A,
            deleted_at: null,
          },
        },
        // AAA Sin Hilo — sin hilo, alfabéticamente antes que ZZZ
        {
          usuario_id: '00000000-0000-0000-0000-000000000045',
          usuario: { nombre_completo: 'AAA Sin Hilo' },
          nino: {
            id: 'n45',
            nombre: 'NF',
            apellidos: '',
            centro_id: CENTRO_A,
            deleted_at: null,
          },
        },
      ],
      convs: [
        {
          id: 'c41',
          tutor_id: '00000000-0000-0000-0000-000000000041',
          expires_at: expiresBajo,
          last_message_at: hace1h,
        },
        {
          id: 'c42',
          tutor_id: '00000000-0000-0000-0000-000000000042',
          expires_at: expiresBajo,
          last_message_at: ahora,
        },
        {
          id: 'c43',
          tutor_id: '00000000-0000-0000-0000-000000000043',
          expires_at: expiresAlto,
          last_message_at: null,
        },
        {
          id: 'c44',
          tutor_id: '00000000-0000-0000-0000-000000000044',
          expires_at: expiresBajo,
          last_message_at: null,
        },
      ],
      msgs: [
        {
          conversacion_id: 'c41',
          contenido: 'Hola AAA',
          erroneo: false,
          created_at: hace1h,
          autor_id: USER_ID,
        },
        {
          conversacion_id: 'c42',
          contenido: 'Hola BBB',
          erroneo: false,
          created_at: ahora,
          autor_id: USER_ID,
        },
      ],
      lecturas: [],
    })

    const items = await getTutoresParaAdminDireccionCore(client, USER_ID, CENTRO_A)
    expect(items.map((i) => i.nombre_completo)).toEqual([
      'BBB Segundo', // hilo activo, más reciente
      'AAA Primero', // hilo activo, anterior
      'CCC Vacío Alto', // hilo vacío, expires alto
      'DDD Vacío Bajo', // hilo vacío, expires bajo
      'AAA Sin Hilo', // sin hilo, alfabético
      'ZZZ Último', // sin hilo, alfabético
    ])
  })

  it('unread_count ignora mensajes propios y anulados', async () => {
    const client = makeClient({
      vinculos: [
        {
          usuario_id: '00000000-0000-0000-0000-000000000050',
          usuario: { nombre_completo: 'Tutor Unread' },
          nino: {
            id: 'n50',
            nombre: 'Hijo',
            apellidos: '',
            centro_id: CENTRO_A,
            deleted_at: null,
          },
        },
      ],
      convs: [
        {
          id: 'c50',
          tutor_id: '00000000-0000-0000-0000-000000000050',
          expires_at: '2026-06-01T00:00:00Z',
          last_message_at: '2026-05-29T10:00:00Z',
        },
      ],
      msgs: [
        // Propio (autor=USER_ID): NO cuenta como unread.
        {
          conversacion_id: 'c50',
          contenido: 'Propio',
          erroneo: false,
          created_at: '2026-05-29T10:00:00Z',
          autor_id: USER_ID,
        },
        // Ajeno + erroneo: NO cuenta.
        {
          conversacion_id: 'c50',
          contenido: 'Tachado',
          erroneo: true,
          created_at: '2026-05-29T09:30:00Z',
          autor_id: '00000000-0000-0000-0000-000000000050',
        },
        // Ajeno + válido + posterior a last_read: cuenta.
        {
          conversacion_id: 'c50',
          contenido: 'Mensaje 1',
          erroneo: false,
          created_at: '2026-05-29T09:20:00Z',
          autor_id: '00000000-0000-0000-0000-000000000050',
        },
        // Ajeno + válido + posterior a last_read: cuenta.
        {
          conversacion_id: 'c50',
          contenido: 'Mensaje 2',
          erroneo: false,
          created_at: '2026-05-29T09:10:00Z',
          autor_id: '00000000-0000-0000-0000-000000000050',
        },
        // Ajeno + válido + anterior a last_read: NO cuenta.
        {
          conversacion_id: 'c50',
          contenido: 'Viejo',
          erroneo: false,
          created_at: '2026-05-29T08:00:00Z',
          autor_id: '00000000-0000-0000-0000-000000000050',
        },
      ],
      lecturas: [{ conversacion_id: 'c50', last_read_at: '2026-05-29T09:00:00Z' }],
    })

    const items = await getTutoresParaAdminDireccionCore(client, USER_ID, CENTRO_A)
    expect(items).toHaveLength(1)
    expect(items[0]!.unread_count).toBe(2)
    // El último (mi propio mensaje) es válido y no anulado: preview no
    // es null. (`last_message_preview` toma el primer no-anulado de la
    // lista ordenada por created_at desc; al ser propio sigue contando
    // como preview.)
    expect(items[0]!.last_message_preview).toBe('Propio')
  })

  it('last_message_preview es null cuando el último mensaje está anulado', async () => {
    const client = makeClient({
      vinculos: [
        {
          usuario_id: '00000000-0000-0000-0000-000000000060',
          usuario: { nombre_completo: 'Tutor Anulado' },
          nino: {
            id: 'n60',
            nombre: 'Hijo',
            apellidos: '',
            centro_id: CENTRO_A,
            deleted_at: null,
          },
        },
      ],
      convs: [
        {
          id: 'c60',
          tutor_id: '00000000-0000-0000-0000-000000000060',
          expires_at: '2026-06-01T00:00:00Z',
          last_message_at: '2026-05-29T10:00:00Z',
        },
      ],
      msgs: [
        {
          conversacion_id: 'c60',
          contenido: '[anulado] mensaje original',
          erroneo: true,
          created_at: '2026-05-29T10:00:00Z',
          autor_id: USER_ID,
        },
      ],
      lecturas: [],
    })

    const items = await getTutoresParaAdminDireccionCore(client, USER_ID, CENTRO_A)
    expect(items[0]!.last_message_preview).toBeNull()
  })
})
