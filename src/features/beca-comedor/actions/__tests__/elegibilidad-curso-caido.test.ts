import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Censo C (B1, 2026-11-26): `getCursoActivo` lanza ahora con la lectura caída (antes era «sin curso
 * activo»). Las acciones que la llaman sin `try` la recogen: aquí, marcar a un niño como becado. Las otras
 * dos (campaña e informe) siguen el mismo molde. Fixtures ficticios.
 */
const { estado } = vi.hoisted(() => ({ estado: { cursoCaido: false, escrituras: 0 } }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/features/centros/contexto/roles-del-usuario', () => ({
  usuarioAdminEn: async () => 'u-1',
}))
vi.mock('@/features/cursos/queries/get-cursos', async () => {
  const { LecturaFallida } = await import('@/shared/lib/lectura-fallida')
  return {
    getCursoActivo: async () => {
      if (estado.cursoCaido)
        throw new LecturaFallida('getCursoActivo', { code: 'XX000', message: 'x' })
      return { id: 'curso-1' }
    },
  }
})
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => {
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) c[m] = () => c
      c.maybeSingle = async () => ({ data: { centro_id: 'c-1' }, error: null })
      c.upsert = async () => {
        estado.escrituras++
        return { error: null }
      }
      return c
    },
  }),
}))
const { toggleElegibilidad } = await import('../elegibilidad')
const ENTRADA = { nino_id: '00000000-0000-4000-8000-000000000001', activa: true }

beforeEach(() => {
  estado.cursoCaido = false
  estado.escrituras = 0
})

describe('toggleElegibilidad', () => {
  it('premisa: con el curso leído, escribe la elegibilidad', async () => {
    expect((await toggleElegibilidad(ENTRADA)).success).toBe(true)
    expect(estado.escrituras).toBe(1)
  })

  it('con el curso activo sin leer: lectura_fallida (no «sin curso»), y no escribe', async () => {
    estado.cursoCaido = true
    expect(await toggleElegibilidad(ENTRADA)).toEqual({
      success: false,
      error: 'common.lectura_fallida',
    })
    expect(estado.escrituras).toBe(0)
  })
})
