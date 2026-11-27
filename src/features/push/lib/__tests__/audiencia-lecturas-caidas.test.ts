import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Censo C (B1, lista blanca, 2026-11-26): las audiencias del push con una lectura caída. El push es
 * best-effort y va después de algo ya guardado (el mensaje, la firma): no para. Pero antes el fallo se
 * perdía (nada, o un `warn`); ahora va a Sentry. Fixtures ficticios.
 */
const { estado, logError } = vi.hoisted(() => ({
  estado: { falla: null as string | null },
  logError: vi.fn(),
}))
vi.mock('@/shared/lib/logger', () => ({ logger: { error: logError, warn: vi.fn() } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    from: (tabla: string) => {
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'in']) c[m] = () => c
      c.then = (res: (v: unknown) => unknown) =>
        Promise.resolve(
          estado.falla === tabla
            ? { data: null, error: { code: 'XX000', message: 'caída' } }
            : {
                data:
                  tabla === 'matriculas'
                    ? [{ aula_id: 'a-1' }]
                    : tabla === 'profes_aulas'
                      ? [{ profe_id: 'p-1' }]
                      : [{ id: 'u-1', idioma_preferido: 'va' }],
                error: null,
              }
        ).then(res)
      return c
    },
  }),
}))

const { profesDelAulaDelNino, idiomasDeUsuarios } = await import('../audiencia')
const enSentry = () => logError.mock.calls.map((c) => String(c[0]))

beforeEach(() => {
  estado.falla = null
  logError.mockClear()
})

describe('profesDelAulaDelNino', () => {
  it('premisa: con todo leído, la profe del aula y nada a Sentry', async () => {
    expect(await profesDelAulaDelNino('n-1')).toEqual(['p-1'])
    expect(enSentry()).toEqual([])
  })

  it.each([
    ['matriculas', 'aula del niño'],
    ['profes_aulas', 'profes del aula'],
  ])('con %s caída: nadie (best-effort), y va a Sentry', async (tabla, donde) => {
    estado.falla = tabla
    expect(await profesDelAulaDelNino('n-1')).toEqual([])
    expect(enSentry()).toContainEqual(expect.stringContaining(donde))
  })
})

describe('idiomasDeUsuarios', () => {
  it('premisa: con la lectura bien, el idioma de cada uno', async () => {
    expect((await idiomasDeUsuarios(['u-1'])).get('u-1')).toBe('va')
  })

  it('sin leerlos: el idioma por defecto (de siempre), y va a Sentry', async () => {
    estado.falla = 'usuarios'
    expect((await idiomasDeUsuarios(['u-1'])).get('u-1')).toBeUndefined()
    expect(enSentry()).toContainEqual(expect.stringContaining('idiomas de los destinatarios'))
  })
})
