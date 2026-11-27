import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Censo C (B1, 2026-11-26): crear una sala. Si su configuración del curso no entra, la sala se retira; esa
 * retirada se esperaba y se tiraba. Si fallaba, la sala quedaba sin configuración (no sale en la lista) y
 * crearla otra vez diría «ya hay una sala con ese nombre». Ahora lo dice, y va a Sentry. Fixtures ficticios.
 */
const { bd, logError } = vi.hoisted(() => ({
  bd: { configFalla: false, retirarFalla: false, escrituras: [] as string[] },
  logError: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/shared/lib/logger', () => ({ logger: { error: logError, warn: vi.fn() } }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (tabla: string) => ({
      insert: () => {
        bd.escrituras.push(`insert ${tabla}`)
        if (tabla === 'aulas')
          return { select: () => ({ single: async () => ({ data: { id: 'a-1' }, error: null }) }) }
        return Promise.resolve({ error: bd.configFalla ? { code: 'XX000', message: 'no' } : null })
      },
      delete: () => ({
        eq: async () => {
          bd.escrituras.push(`delete ${tabla}`)
          return { error: bd.retirarFalla ? { code: 'XX000', message: 'no' } : null }
        },
      }),
    }),
  }),
}))
const { createAula } = await import('../create-aula')
const SALA = { nombre: 'Sala Demo', cohorte_anos_nacimiento: [2024], capacidad_maxima: 12 }

beforeEach(() => {
  Object.assign(bd, { configFalla: false, retirarFalla: false, escrituras: [] })
  logError.mockClear()
})

describe('createAula', () => {
  it('premisa: con todo bien, crea la sala y su configuración', async () => {
    expect(await createAula('c-1', 'curso-1', SALA)).toEqual({ success: true, data: { id: 'a-1' } })
  })

  it('premisa de la retirada: configuración fallida y sala retirada → «no se pudo crear»', async () => {
    bd.configFalla = true
    expect(await createAula('c-1', 'curso-1', SALA)).toEqual({
      success: false,
      error: 'aula.errors.create_failed',
    })
    expect(bd.escrituras).toContain('delete aulas')
  })

  it('si la sala tampoco se retira: dice que quedó a medias, y va a Sentry', async () => {
    bd.configFalla = true
    bd.retirarFalla = true
    expect(await createAula('c-1', 'curso-1', SALA)).toEqual({
      success: false,
      error: 'aula.errors.sala_a_medias',
    })
    expect(logError).toHaveBeenCalled()
  })
})
