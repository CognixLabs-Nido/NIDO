import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * PR-D (auditoría F11-D, D2) — `actualizarNinoFamilia` escribe por la RPC
 * `actualizar_familia_nino` con el cliente de SESIÓN, nunca con service role: así
 * `auth.uid()` es el del JWT y `audit_log` registra al humano real (antes, NULL).
 *
 *  - tutor legal / admin del centro, alta sin validar → RPC con el parche presente.
 *  - el service role no se crea (el mock de admin lanza si alguien lo usa).
 *  - 42501 de la RPC → no autorizado; otro error → guardado.
 *  - alta validada → cola `cambios_pendientes`, sin RPC.
 *  - ni tutor ni admin → no autorizado sin RPC.
 *  - parche vacío → ok sin RPC.
 */

const USER = '11111111-1111-4111-8111-111111111111'
const NINO = '22222222-2222-4222-8222-222222222222'

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClientMock() }))

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => {
    throw new Error('service role NO debe usarse para escribir ninos')
  },
}))

const authz = { tutor: false, admin: false }
vi.mock('../../lib/authz-tutor', () => ({
  esTutorLegalDe: () => Promise.resolve(authz.tutor),
  esAdminDeCentroDeNino: () => Promise.resolve(authz.admin),
}))

const gate = { validada: false }
const registrarSpy = vi.fn()
vi.mock('@/features/cambios-pendientes/lib/gate', () => ({
  altaValidada: () => Promise.resolve(gate.validada),
  registrarCambioPendiente: (...a: unknown[]) => {
    registrarSpy(...a)
    return Promise.resolve({ ok: true })
  },
}))

import { actualizarNinoFamilia } from '../actualizar-nino-familia'

function makeFake(rpcError: { code?: string; message: string } | null = null) {
  const rpcSpy = vi.fn()
  const fake = {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: USER } } }) },
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcSpy(fn, args)
      return Promise.resolve({ data: NINO, error: rpcError })
    },
  }
  return { fake, rpcSpy }
}

beforeEach(() => {
  vi.clearAllMocks()
  authz.tutor = false
  authz.admin = false
  gate.validada = false
})

describe('actualizarNinoFamilia — escribe por RPC de sesión (D2)', () => {
  it('tutor legal: llama a actualizar_familia_nino solo con las claves presentes', async () => {
    authz.tutor = true
    const { fake, rpcSpy } = makeFake()
    createClientMock.mockReturnValue(fake)

    const r = await actualizarNinoFamilia({
      nino_id: NINO,
      direccion_calle: 'Calle Mayor',
      direccion_cp: null,
    })

    expect(r).toEqual({ success: true, data: { id: NINO } })
    expect(rpcSpy).toHaveBeenCalledTimes(1)
    expect(rpcSpy).toHaveBeenCalledWith('actualizar_familia_nino', {
      p_nino_id: NINO,
      p_patch: { direccion_calle: 'Calle Mayor', direccion_cp: null },
    })
  })

  it('admin del centro (modo Dirección): misma RPC de sesión', async () => {
    authz.admin = true
    const { fake, rpcSpy } = makeFake()
    createClientMock.mockReturnValue(fake)

    const r = await actualizarNinoFamilia({ nino_id: NINO, estado_civil_familia: 'casados' })

    expect(r.success).toBe(true)
    expect(rpcSpy).toHaveBeenCalledWith('actualizar_familia_nino', {
      p_nino_id: NINO,
      p_patch: { estado_civil_familia: 'casados' },
    })
  })

  it('42501 de la RPC → no autorizado', async () => {
    authz.tutor = true
    const { fake } = makeFake({ code: '42501', message: 'No autorizado' })
    createClientMock.mockReturnValue(fake)

    const r = await actualizarNinoFamilia({ nino_id: NINO, direccion_calle: 'X' })

    expect(r).toEqual({ success: false, error: 'alta.errors.no_autorizado' })
  })

  it('otro error de la RPC → error de guardado', async () => {
    authz.tutor = true
    const { fake } = makeFake({ code: '22023', message: 'columna no permitida' })
    createClientMock.mockReturnValue(fake)

    const r = await actualizarNinoFamilia({ nino_id: NINO, direccion_calle: 'X' })

    expect(r).toEqual({ success: false, error: 'alta.documentos.errors.guardado' })
  })

  it('alta validada → cola de validación, sin RPC', async () => {
    authz.tutor = true
    gate.validada = true
    const { fake, rpcSpy } = makeFake()
    createClientMock.mockReturnValue(fake)

    const r = await actualizarNinoFamilia({ nino_id: NINO, direccion_calle: 'X' })

    expect(r).toEqual({ success: true, data: { id: NINO, pendienteValidacion: true } })
    expect(registrarSpy).toHaveBeenCalledTimes(1)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('ni tutor legal ni admin → no autorizado sin RPC', async () => {
    const { fake, rpcSpy } = makeFake()
    createClientMock.mockReturnValue(fake)

    const r = await actualizarNinoFamilia({ nino_id: NINO, direccion_calle: 'X' })

    expect(r).toEqual({ success: false, error: 'alta.errors.no_autorizado' })
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('parche vacío → ok sin RPC', async () => {
    authz.tutor = true
    const { fake, rpcSpy } = makeFake()
    createClientMock.mockReturnValue(fake)

    const r = await actualizarNinoFamilia({ nino_id: NINO })

    expect(r).toEqual({ success: true, data: { id: NINO } })
    expect(rpcSpy).not.toHaveBeenCalled()
  })
})
