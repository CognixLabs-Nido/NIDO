import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  SECCIONES_RECOLECTAR,
  type DecisionColumnaApp,
  type RutaRecolectar,
} from '../columnas-recolectar'
import { recolectarNino, recolectarUsuario } from '../recolectar'
import { SALE_SIN_REPASAR_2026_11_01 } from './sale-sin-repasar-2026-11-01'

/**
 * La red del export art. 15, la mitad de la app: `recolectar.ts` pide a cada tabla exactamente las
 * columnas que el catálogo dice que salen (`columnas-recolectar.ts`), ninguna lectura pide `*`, un
 * fallo de lectura rompe el export, y lo que sale sin repasar solo mengua.
 *
 * Se mide lo que HACE, no lo que pone el fichero: un cliente de mentira apunta a qué tabla va cada
 * lectura y qué columnas pide, y los dos recolectores corren enteros contra él. Que las columnas
 * del catálogo son las de la base de verdad lo prueba `export-columnas.rls.test.ts`.
 */

type Client = SupabaseClient<Database>

interface Llamada {
  tabla: string
  select: string | null
}

interface Respuesta {
  data: unknown
  error: { message: string } | null
}

interface Constructor {
  select(columnas: string): Constructor
  eq(): Constructor
  in(): Constructor
  or(): Constructor
  maybeSingle(): Promise<Respuesta>
  then<A, B = never>(
    ok?: ((r: Respuesta) => A | PromiseLike<A>) | null,
    ko?: ((e: unknown) => B | PromiseLike<B>) | null
  ): Promise<A | B>
}

/** Filas que hacen recorrer todos los caminos: un hijo, su hilo y una foto suya del blog. */
const FILAS: Record<string, Fila[]> = {
  usuarios: [{ id: 'u1' }],
  vinculos_familiares: [{ tipo_vinculo: 'tutor_legal_principal', nino_id: 'n1' }],
  conversaciones: [{ id: 'c1' }],
  ninos: [{ id: 'n1', foto_url: null, deleted_reason: null, centro_id: 'k1' }],
  media_etiquetas: [{ media_id: 'm1', nino_id: 'n1' }],
  media: [{ id: 'm1', bucket: 'aula-fotos', path: 'p', publicacion_id: 'p1', created_at: 'x' }],
  publicaciones: [{ id: 'p1', texto: 't', created_at: 'x' }],
}
type Fila = Record<string, unknown>

function clienteDeMentira(fallaEn?: string) {
  const llamadas: Llamada[] = []
  const client = {
    from(tabla: string) {
      const llamada: Llamada = { tabla, select: null }
      llamadas.push(llamada)
      const respuesta = (): Respuesta =>
        tabla === fallaEn
          ? { data: null, error: { message: 'columna inexistente' } }
          : { data: FILAS[tabla] ?? [], error: null }
      const b: Constructor = {
        select(columnas) {
          llamada.select = columnas
          return b
        },
        eq: () => b,
        in: () => b,
        or: () => b,
        maybeSingle: async () => {
          const r = respuesta()
          return r.error ? r : { data: (r.data as Fila[])[0] ?? null, error: null }
        },
        then: (ok, ko) => Promise.resolve(respuesta()).then(ok, ko),
      }
      return b
    },
    rpc: async () => ({ data: null, error: null }),
    storage: {
      from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://x' } }) }),
    },
  }
  return { client: client as unknown as Client, llamadas }
}

async function recolectarTodo(fallaEn?: string) {
  const { client, llamadas } = clienteDeMentira(fallaEn)
  await recolectarUsuario(client, client, 'u1')
  await recolectarNino(client, client, 'n1')
  return llamadas
}

const catalogo = SECCIONES_RECOLECTAR as Record<
  RutaRecolectar,
  { tabla: string; columnas: Record<string, DecisionColumnaApp> }
>
const rutas = Object.keys(catalogo) as RutaRecolectar[]

/**
 * Lo que pide un `select`, como conjunto: `a, b, hija(c, d)` → `a`, `b`, `hija.c`, `hija.d`. Se
 * calcula aquí, sin `columnasDe`: el test no se fía de la función que comprueba.
 */
function pedidas(select: string): string[] {
  const out: string[] = []
  let resto = select
  const embebida = /(\w+)\(([^()]*)\)/g
  for (const m of select.matchAll(embebida)) {
    for (const c of m[2].split(',')) out.push(`${m[1]}.${c.trim()}`)
    resto = resto.replace(m[0], '')
  }
  for (const c of resto.split(',')) if (c.trim()) out.push(c.trim())
  return out.sort()
}

/** Las columnas que salen de una sección según el catálogo: todo lo que no es `noSale`. */
function queSalen(r: RutaRecolectar, prefijo = ''): string[] {
  return Object.entries(catalogo[r].columnas)
    .filter(([, d]) => !('noSale' in d))
    .map(([c]) => prefijo + c)
}

/** Lo que pide cada sección: su tabla y sus columnas. La agenda, con sus cuatro tablas dentro. */
function esperadas(): Array<{ rutas: RutaRecolectar[]; tabla: string; columnas: string[] }> {
  const agenda = rutas.filter((r) => r.startsWith('nino.agendas_diarias.'))
  return [
    ...rutas
      .filter((r) => !agenda.includes(r) && r !== 'nino.agendas_diarias')
      .map((r) => ({ rutas: [r], tabla: catalogo[r].tabla, columnas: queSalen(r).sort() })),
    {
      rutas: ['nino.agendas_diarias', ...agenda],
      tabla: 'agendas_diarias',
      columnas: [
        ...queSalen('nino.agendas_diarias'),
        ...agenda.flatMap((r) => queSalen(r, `${catalogo[r].tabla}.`)),
      ].sort(),
    },
  ]
}

/**
 * Las lecturas que no son una sección del catálogo, cada una con su porqué: no entregan la fila,
 * solo encuentran otras o sacan un dato que se escribe aparte. Cualquier otra lectura es un rojo.
 */
const APARTE: Record<string, string> = {
  'conversaciones|id': 'solo encuentra los hilos del sujeto; sus mensajes salen en mensajes',
  'media_etiquetas|media_id': 'solo encuentra las fotos del blog donde sale el niño',
  'media_etiquetas|media_id, nino_id': 'cuenta con cuántos niños más sale cada foto',
  'media|id, bucket, path, publicacion_id, created_at':
    'la foto exclusiva sale como enlace firmado; la compartida, como metadata escrita aparte',
  'publicaciones|id, texto, created_at': 'el texto y la fecha de la publicación de la foto',
}

describe('la red del export: lo que recolectar.ts pide a cada tabla', () => {
  it('premisa: los dos recolectores recorren todos sus caminos', async () => {
    const llamadas = await recolectarTodo()
    const tablas = new Set(llamadas.map((l) => l.tabla))
    for (const t of ['mensajes', 'media', 'publicaciones', 'roles_usuario', 'agendas_diarias'])
      expect(tablas, t).toContain(t)
    expect(llamadas.length).toBeGreaterThan(20)
  })

  it('premisa: el cálculo de lo que pide un select lee las embebidas', () => {
    expect(pedidas('a, b, hija(c, d), otra(e)')).toEqual(['a', 'b', 'hija.c', 'hija.d', 'otra.e'])
  })

  it('ninguna lectura pide todas las columnas', async () => {
    for (const l of await recolectarTodo()) {
      expect(l.select, l.tabla).not.toBeNull()
      expect(l.select!, l.tabla).not.toMatch(/\*/)
    }
  })

  it('cada lectura pide a su tabla exactamente las columnas que salen, y cada sección se lee', async () => {
    const llamadas = await recolectarTodo()
    const todas = esperadas()
    const leidas = new Set<RutaRecolectar>()
    for (const l of llamadas) {
      const casa = todas.filter(
        (e) => e.tabla === l.tabla && pedidas(l.select!).join() === e.columnas.join()
      )
      if (casa.length === 0) {
        expect(
          APARTE[`${l.tabla}|${l.select}`],
          `${l.tabla} se lee con «${l.select}», que no es ninguna sección del catálogo`
        ).toBeDefined()
      }
      for (const e of casa) for (const r of e.rutas) leidas.add(r)
    }
    expect([...leidas].sort()).toEqual([...rutas].sort())
  })

  it('un fallo de lectura rompe el export, en cada tabla que lee', async () => {
    const tablas = new Set((await recolectarTodo()).map((l) => l.tabla))
    // Premisa: sin fallo, los dos terminan.
    await expect(recolectarTodo()).resolves.toBeDefined()
    for (const t of tablas) await expect(recolectarTodo(t), t).rejects.toThrow(/falló/)
  })

  it('lo que sale, sale con su nombre de columna', () => {
    for (const r of rutas)
      for (const [col, d] of Object.entries(catalogo[r].columnas))
        if ('sale' in d) expect(d.sale, `${r}.${col}`).toBe(true)
  })

  it('cada columna que no sale a propósito lleva su porqué', () => {
    // Hoy ninguna: el trozo 3 no cambia lo que sale. Las primeras llegan con el repaso (trozo 2).
    for (const r of rutas)
      for (const [col, d] of Object.entries(catalogo[r].columnas))
        if ('noSale' in d) {
          expect(d.noSale.trim().length, `${r}.${col}`).toBeGreaterThanOrEqual(40)
          expect(d.noSale, `${r}.${col}`).not.toMatch(/TODO|por decidir|sin repasar/i)
        }
  })

  it('lo que sale sin repasar es lo del 2026-11-01, y solo mengua', () => {
    const sinRepasar = rutas.flatMap((r) =>
      Object.entries(catalogo[r].columnas).flatMap(([col, d]) =>
        'saleSinRepasar' in d ? [`${r}.${col}`] : []
      )
    )
    console.warn(`export (app): ${sinRepasar.length} columnas salen sin repasar`)
    expect(sinRepasar.sort()).toEqual([...SALE_SIN_REPASAR_2026_11_01].sort())
  })
})
