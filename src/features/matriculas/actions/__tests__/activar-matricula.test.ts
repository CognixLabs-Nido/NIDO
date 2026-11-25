import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Censo C (2026-11-25): `validar_alta` ya validó el alta cuando se lee la matrícula para invitar al
 * segundo tutor. El codemod puso ahí «no se ha podido leer», y la directora, a quien la pantalla le dice
 * que el alta no se validó cuando sí, la vuelve a validar. Decisión de Jose: «Guardado; no se ha podido
 * enviar el aviso o el correo», visible, para que pueda reenviarlo (Altas en proceso).
 */

const h = vi.hoisted(() => ({
  lectura: { data: { nino_id: 'nino-1' } as unknown, error: null as unknown },
  invitacion: 'enviada' as 'enviada' | 'no_hacia_falta' | 'no_enviada',
  invitados: [] as string[],
}))

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: async () => ({ data: 'matricula-1', error: null }),
    from: () => {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) b[m] = () => b
      b.maybeSingle = async () => h.lectura
      return b
    },
  }),
}))
vi.mock('../../lib/invitar-tutor-2', () => ({
  invitarTutor2AlValidar: async (_s: unknown, ninoId: string) => {
    h.invitados.push(ninoId)
    return h.invitacion
  },
}))

const { activarMatricula } = await import('../activar-matricula')

const MATRICULA = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  h.lectura = { data: { nino_id: 'nino-1' }, error: null }
  h.invitacion = 'enviada'
  h.invitados = []
})

describe('activarMatricula: el alta validada no se cuenta como fallida', () => {
  it('premisa: validada e invitado el segundo tutor, sin aviso', async () => {
    expect(await activarMatricula(MATRICULA, '2026-12-01')).toEqual({
      success: true,
      data: { id: 'matricula-1' },
    })
    expect(h.invitados).toEqual(['nino-1'])
  })

  it('no se puede leer la matrícula tras validar: validada, con el aviso visible', async () => {
    h.lectura = { data: null, error: { message: 'timeout' } }
    expect(await activarMatricula(MATRICULA, '2026-12-01')).toEqual({
      success: true,
      data: { id: 'matricula-1', aviso: 'common.guardado_sin_aviso' },
    })
  })

  it('la invitación al segundo tutor no sale: validada, con el aviso visible', async () => {
    h.invitacion = 'no_enviada'
    expect(await activarMatricula(MATRICULA, '2026-12-01')).toEqual({
      success: true,
      data: { id: 'matricula-1', aviso: 'common.guardado_sin_aviso' },
    })
  })
})
