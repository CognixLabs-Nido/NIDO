// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Las acciones de las peticiones de olvido: llaman a su función con la sesión, traducen el error
 * por su HINT y avisan. Una petición nueva de la familia: acuse por correo y push a la titular; la
 * que registra la propia titular, sin push. Cada cambio, correo a la familia.
 */

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  pedidaPorCentro: false,
  avisarFamilia: vi.fn(async () => 1),
  avisarTitular: vi.fn(async () => undefined),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: h.rpc }) }))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) b[m] = () => b
      b.maybeSingle = async () => ({
        data: { centro_id: 'c-1', pedida_por_centro: h.pedidaPorCentro },
        error: null,
      })
      return b
    },
  }),
}))
vi.mock('../../lib/avisar', () => ({
  avisarFamilia: h.avisarFamilia,
  avisarTitular: h.avisarTitular,
}))

const acciones = await import('../peticiones')

beforeEach(() => {
  vi.clearAllMocks()
  h.pedidaPorCentro = false
})

describe('pedir', () => {
  it('la familia pide: acuse a la familia y push a la titular', async () => {
    h.rpc.mockResolvedValueOnce({ data: 'sol-1', error: null })
    const r = await acciones.pedirOlvidoNino('nino-1', { casilla: true })
    expect(r).toEqual({ success: true, data: 'sol-1' })
    expect(h.rpc).toHaveBeenCalledWith('pedir_olvido_nino', {
      p_nino_id: 'nino-1',
      p_inmediato: true,
    })
    expect(h.avisarFamilia).toHaveBeenCalledWith(expect.anything(), 'sol-1', 'pedida')
    expect(h.avisarTitular).toHaveBeenCalledWith(expect.anything(), 'c-1')
  })

  it('la registra la titular: acuse a la familia, sin push a sí misma', async () => {
    h.pedidaPorCentro = true
    h.rpc.mockResolvedValueOnce({ data: 'sol-2', error: null })
    await acciones.pedirOlvidoUsuario('u-1', 'c-1')
    expect(h.rpc).toHaveBeenCalledWith('pedir_olvido_usuario', {
      p_usuario_id: 'u-1',
      p_centro_id: 'c-1',
      p_inmediato: false,
    })
    expect(h.avisarFamilia).toHaveBeenCalledWith(expect.anything(), 'sol-2', 'pedida')
    expect(h.avisarTitular).not.toHaveBeenCalled()
  })

  it('una petición repetida da su error y no avisa a nadie', async () => {
    h.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', hint: 'ya_pedida', message: 'x' },
    })
    const r = await acciones.pedirOlvidoNino('nino-1')
    expect(r).toEqual({ success: false, error: 'olvido.errores.ya_pedida' })
    expect(h.avisarFamilia).not.toHaveBeenCalled()
    expect(h.avisarTitular).not.toHaveBeenCalled()
  })
})

describe('la titular', () => {
  it('confirmar con bloqueos da su error; sin bloqueos, avisa a la familia', async () => {
    h.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '55000', hint: 'hay_bloqueos', message: 'x' },
    })
    expect(await acciones.confirmarPeticionOlvido('sol-1')).toEqual({
      success: false,
      error: 'olvido.errores.hay_bloqueos',
    })
    expect(h.avisarFamilia).not.toHaveBeenCalled()

    h.rpc.mockResolvedValueOnce({ data: '2026-11-03T00:00:00Z', error: null })
    expect((await acciones.confirmarPeticionOlvido('sol-1')).success).toBe(true)
    expect(h.avisarFamilia).toHaveBeenCalledWith(expect.anything(), 'sol-1', 'confirmada')
  })

  it('rechazar sin motivo no llega a la BD', async () => {
    const r = await acciones.rechazarPeticionOlvido('sol-1', { texto: '   ' })
    expect(r).toEqual({ success: false, error: 'olvido.errores.motivo_obligatorio' })
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('rechazar, retirar y deshacer avisan a la familia; la nota, no', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null })
    await acciones.rechazarPeticionOlvido('s', { texto: 'Sigue matriculado' })
    await acciones.retirarPeticionOlvido('s')
    await acciones.deshacerConfirmacionOlvido('s')
    await acciones.guardarNotaPeticionOlvido('s', { texto: 'Falta un recibo' })
    expect(h.avisarFamilia.mock.calls.map((c) => (c as unknown[])[2])).toEqual([
      'rechazada',
      'retirada',
      'deshecha',
    ])
    expect(h.rpc).toHaveBeenCalledWith('rechazar_peticion_olvido', {
      p_solicitud_id: 's',
      p_motivo: 'Sigue matriculado',
    })
  })

  it('sin permiso, el error de permiso', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'x' } })
    expect(await acciones.deshacerConfirmacionOlvido('s')).toEqual({
      success: false,
      error: 'olvido.errores.no_autorizado',
    })
  })
})
