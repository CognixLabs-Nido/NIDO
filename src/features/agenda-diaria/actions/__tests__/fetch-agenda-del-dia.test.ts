import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LecturaFallida } from '@/shared/lib/lectura-fallida'

/**
 * Censo C (B1, 2026-11-26): la acción que lee la agenda de un niño para la tarjeta del aula. Con la lectura
 * caída devuelve `null` («no se pudo leer»), nunca la agenda vacía: con ella, la tarjeta enseñaba los
 * formularios en blanco. Un error que no es de lectura sigue subiendo. Fixtures ficticios.
 */
const { lectura } = vi.hoisted(() => ({ lectura: { resultado: null as unknown } }))
vi.mock('@/shared/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))
vi.mock('../../queries/get-agenda-del-dia', () => ({
  getAgendaDelDia: async () => {
    if (lectura.resultado instanceof Error) throw lectura.resultado
    return lectura.resultado
  },
}))

const { fetchAgendaDelDia } = await import('../fetch-agenda-del-dia')
const AGENDA = { cabecera: null, comidas: [], biberones: [], suenos: [], deposiciones: [] }

beforeEach(() => {
  lectura.resultado = AGENDA
})

describe('fetchAgendaDelDia', () => {
  it('premisa: con la agenda leída, la devuelve', async () => {
    expect(await fetchAgendaDelDia('n-1', '2026-11-26')).toEqual(AGENDA)
  })

  it('con la lectura caída: null, no la agenda vacía', async () => {
    lectura.resultado = new LecturaFallida('agenda del día: cabecera', {
      code: 'XX000',
      message: 'x',
    })
    expect(await fetchAgendaDelDia('n-1', '2026-11-26')).toBeNull()
  })

  it('un error que no es de lectura sigue subiendo', async () => {
    lectura.resultado = new Error('otra cosa')
    await expect(fetchAgendaDelDia('n-1', '2026-11-26')).rejects.toThrow('otra cosa')
  })
})
