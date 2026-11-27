// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/db'

/**
 * Censo C (B1, lista blanca, 2026-11-26): el manifiesto de adjuntos del olvido, con una lectura caída. Se
 * recorre ANTES de la purga SQL. Antes, en la foto de perfil, el libro de familia y las fotos del blog, una
 * lectura caída era «no hay nada que borrar»: la purga seguía y los ficheros del niño se quedaban en el
 * bucket sin ninguna fila que los nombrara. Y una, peor: sin «quién más sale en sus fotos», `[].every(…)`
 * es TRUE y todas contaban como exclusivas: se borraban también las compartidas con otros niños (el caso
 * de abajo lo mide con una foto compartida). Ahora lanza y para la purga, como ya hacían la tarjeta
 * sanitaria y el justificante. Fixtures ficticios.
 */
vi.mock('server-only', () => ({}))

const { estado } = vi.hoisted(() => ({
  estado: {
    vistas: {} as Record<string, number>,
    falla: null as { clave: string; n: number } | null,
    filas: {} as Record<string, unknown>,
  },
}))

/** ¿Falla esta lectura? `clave` es la tabla o `storage:<bucket>`; `n`, la n-ésima vez que se lee. */
function responde(clave: string, v: unknown) {
  const n = (estado.vistas[clave] = (estado.vistas[clave] ?? 0) + 1)
  if (estado.falla?.clave === clave && estado.falla.n === n)
    return { data: null, error: { message: 'caída' } }
  return { data: v, error: null }
}

const service = {
  from: (tabla: string) => {
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'in']) c[m] = () => c
    c.maybeSingle = async () => {
      const v = estado.filas[tabla]
      return responde(tabla, Array.isArray(v) ? (v[0] ?? null) : (v ?? null))
    }
    c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(responde(tabla, estado.filas[tabla] ?? [])).then(res, rej)
    return c
  },
  storage: {
    from: (bucket: string) => ({
      list: async () => responde(`storage:${bucket}`, [{ id: 'o-1', name: 'doc.pdf' }]),
    }),
  },
} as unknown as SupabaseClient<Database>

const { recolectarAdjuntosDe } = await import('../fuentes-adjuntos')
const NINO = { sujeto_tipo: 'nino' as const, sujeto_id: 'n-1', centro_id: 'c-1' }

beforeEach(() => {
  estado.vistas = {}
  estado.falla = null
  estado.filas = {
    ninos: { foto_url: 'c-1/n-1/perfil.jpg', centro_id: 'c-1' },
    // El niño es el único etiquetado en su foto: la foto se borra.
    media_etiquetas: [{ media_id: 'm-1', nino_id: 'n-1' }],
    media: [{ path: 'c-1/a-1/p-1/foto.jpg', path_miniatura: 'c-1/a-1/p-1/mini.jpg' }],
    cambios_pendientes: [],
  }
})

describe('recolectarAdjuntosDe (niño)', () => {
  it('premisa: con todo leído, la foto de perfil, el libro de familia y la foto del blog', async () => {
    const todo = [...(await recolectarAdjuntosDe(service, NINO, true)).values()].flat()
    for (const r of ['c-1/n-1/perfil.jpg', 'c-1/n-1/doc.pdf', 'c-1/a-1/p-1/foto.jpg'])
      expect(todo).toContain(r)
  })

  it.each([
    ['ninos', 1, 'la foto de perfil', /foto de perfil/],
    ['ninos', 2, 'el libro de familia', /ninos \(libro de familia\)/],
    ['storage:libro-familia', 1, 'el listado del libro de familia', /^libro-familia:/],
    ['media_etiquetas', 1, 'las fotos en las que sale', /del niño/],
    ['media_etiquetas', 2, 'quién más sale en ellas', /de sus fotos/],
    ['media', 1, 'las rutas de esas fotos', /^media:/],
  ] as const)(
    'con %s n.º %s caída (%s): no es «nada que borrar», para',
    async (clave, n, _q, mensaje) => {
      estado.falla = { clave, n }
      await expect(recolectarAdjuntosDe(service, NINO, true)).rejects.toThrow(mensaje)
      expect(estado.vistas[clave], 'premisa: llegó a esa lectura').toBeGreaterThanOrEqual(n)
    }
  )
})

// La lectura de «quién más sale» caída, medida por su efecto: con una foto COMPARTIDA, antes salía entre lo
// que se borra. Premisa: con todo leído, la compartida no sale.
describe('la foto compartida con otro niño', () => {
  beforeEach(() => {
    estado.filas.media_etiquetas = [
      { media_id: 'm-1', nino_id: 'n-1' },
      { media_id: 'm-1', nino_id: 'n-2' },
    ]
  })

  it('premisa: con todo leído, la compartida no se borra', async () => {
    const todo = [...(await recolectarAdjuntosDe(service, NINO, true)).values()].flat()
    expect(todo).toContain('c-1/n-1/perfil.jpg')
    expect(todo).not.toContain('c-1/a-1/p-1/foto.jpg')
  })

  it('sin leer quién más sale: no la da por exclusiva, para', async () => {
    estado.falla = { clave: 'media_etiquetas', n: 2 }
    await expect(recolectarAdjuntosDe(service, NINO, true)).rejects.toThrow(/de sus fotos/)
  })
})
