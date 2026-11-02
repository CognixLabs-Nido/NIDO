// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El barrido de los ficheros de remesa (R-1, `20261220120000`): el plazo es el fiscal, con la misma
 * constante que lo fiscal de la familia; primero Storage y después la BD, y si Storage falla no se
 * toca la BD (la ruta se perdería y el fichero, con sus IBAN, se quedaría sin plazo); los objetos
 * sin registro se borran; en simulación solo se cuenta.
 */

const h = vi.hoisted(() => ({
  pasos: [] as string[],
  vencidos: [] as Array<{ fichero_id: string; ruta: string }>,
  huerfanos: [] as Array<{ ruta: string }>,
  errorLista: null as { message: string } | null,
  falloStorage: new Set<string>(),
  // Lo que contesta la BD al destruir: NULL si entre medias lo retuvieron.
  destruir: (id: string): number | null => (id ? 1 : null),
  plazos: [] as unknown[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    rpc: async (nombre: string, a?: Record<string, unknown>) => {
      if (nombre === 'ficheros_remesa_vencidos') {
        h.plazos.push(a?.p_anios)
        return h.errorLista
          ? { data: null, error: h.errorLista }
          : { data: h.vencidos, error: null }
      }
      if (nombre === 'ficheros_remesa_huerfanos') return { data: h.huerfanos, error: null }
      h.pasos.push(`bd ${a?.p_fichero_id}`)
      h.plazos.push(a?.p_anios)
      return { data: h.destruir(a?.p_fichero_id as string), error: null }
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (rutas: string[]) => {
          h.pasos.push(`storage ${bucket} ${rutas.join(',')}`)
          return rutas.some((r) => h.falloStorage.has(r))
            ? { error: { message: 'storage caído' } }
            : { error: null }
        },
      }),
    },
  }),
}))

const { destruirFicherosRemesa } = await import('../ficheros-remesa')
const { ANIOS_FISCAL } = await import('../fiscal')

beforeEach(() => {
  h.pasos = []
  h.vencidos = [
    { fichero_id: 'f1', ruta: 'c1/r1/a.xml' },
    { fichero_id: 'f2', ruta: 'c1/r1/b.xml' },
  ]
  h.huerfanos = [{ ruta: 'c1/r2/x.xml' }]
  h.errorLista = null
  h.falloStorage = new Set()
  h.destruir = (id) => (id === 'f2' ? null : 1)
  h.plazos = []
})

describe('el barrido de los ficheros de remesa', () => {
  it('el plazo es el fiscal: la misma constante que lo fiscal de la familia', async () => {
    await destruirFicherosRemesa({ dryRun: false })
    expect(ANIOS_FISCAL).toBeGreaterThan(0)
    expect(new Set(h.plazos)).toEqual(new Set([ANIOS_FISCAL]))
  })

  it('cada uno, Storage antes que la BD; el que retuvieron entre medias no cuenta', async () => {
    const r = await destruirFicherosRemesa({ dryRun: false })
    expect(h.pasos).toEqual([
      'storage remesas-ficheros c1/r1/a.xml',
      'bd f1',
      'storage remesas-ficheros c1/r1/b.xml',
      'bd f2',
      'storage remesas-ficheros c1/r2/x.xml',
    ])
    expect(r).toEqual({
      dryRun: false,
      vencidos: 2,
      destruidos: 1,
      huerfanos: 1,
      huerfanosBorrados: 1,
      fallidos: 0,
    })
  })

  it('si Storage falla, no se toca la BD de ese fichero y se cuenta como fallido', async () => {
    h.falloStorage = new Set(['c1/r1/a.xml'])
    const r = await destruirFicherosRemesa({ dryRun: false })
    expect(h.pasos).not.toContain('bd f1')
    expect(h.pasos).toContain('bd f2')
    expect(r.fallidos).toBe(1)
  })

  it('en simulación solo cuenta: no borra nada', async () => {
    const r = await destruirFicherosRemesa({ dryRun: true })
    expect(h.pasos).toEqual([])
    expect(r).toEqual({
      dryRun: true,
      vencidos: 2,
      destruidos: 0,
      huerfanos: 1,
      huerfanosBorrados: 0,
      fallidos: 0,
    })
  })

  it('si la lista falla, el recuento es NULL y no se borra ningún vencido', async () => {
    h.errorLista = { message: 'x' }
    const r = await destruirFicherosRemesa({ dryRun: false })
    expect(r.vencidos).toBeNull()
    expect(h.pasos.some((p) => p.startsWith('bd'))).toBe(false)
  })
})
