import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import { responderInvitacionCore } from '../responder-invitacion'

const USER = '11111111-1111-4111-8111-111111111111'
const CITA = '44444444-4444-4444-8444-444444444444'

const FUTURO = '2099-01-01'
const PASADO = '2000-01-01'

interface Setup {
  cita?: { fecha: string; hora_inicio: string; estado: string } | null
  updateResult?: { id: string } | null
}

function makeFake(setup: Setup) {
  const updateSpy = vi.fn()
  const fake = {
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.update = (payload: unknown) => {
        updateSpy(payload)
        return b
      }
      b.maybeSingle = () => {
        if (table === 'citas') return Promise.resolve({ data: setup.cita ?? null, error: null })
        return Promise.resolve({ data: setup.updateResult ?? null, error: null })
      }
      return b
    },
  } as unknown as SupabaseClient<Database>
  return { fake, updateSpy }
}

beforeEach(() => vi.clearAllMocks())

describe('responderInvitacionCore', () => {
  it('actualiza la fila propia con respondido_por y estado', async () => {
    const { fake, updateSpy } = makeFake({
      cita: { fecha: FUTURO, hora_inicio: '17:00', estado: 'programada' },
      updateResult: { id: 'inv-1' },
    })
    const res = await responderInvitacionCore(fake, USER, { cita_id: CITA, estado: 'aceptado' })
    expect(res.success).toBe(true)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ estado: 'aceptado', respondido_por: USER })
    )
  })

  it('rechaza si la ventana ya cerró (la cita ya comenzó)', async () => {
    const { fake } = makeFake({
      cita: { fecha: PASADO, hora_inicio: '17:00', estado: 'programada' },
    })
    const res = await responderInvitacionCore(fake, USER, { cita_id: CITA, estado: 'aceptado' })
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('citas.errors.ventana_cerrada')
  })

  it('rechaza si la cita está cancelada', async () => {
    const { fake } = makeFake({
      cita: { fecha: FUTURO, hora_inicio: '17:00', estado: 'cancelada' },
    })
    const res = await responderInvitacionCore(fake, USER, { cita_id: CITA, estado: 'rechazado' })
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('citas.errors.cita_cancelada')
  })

  it('devuelve no_invitado si el UPDATE no toca ninguna fila', async () => {
    const { fake } = makeFake({
      cita: { fecha: FUTURO, hora_inicio: '17:00', estado: 'programada' },
      updateResult: null,
    })
    const res = await responderInvitacionCore(fake, USER, { cita_id: CITA, estado: 'aceptado' })
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('citas.errors.no_invitado')
  })
})
