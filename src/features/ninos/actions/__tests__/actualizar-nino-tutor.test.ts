import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Puerta de identidad (2026-11-08). Con el alta validada, lo que CAMBIA de la identidad del niño va
 * a la cola de Dirección (`ninos_identidad`) y a la RPC le llega como NULL («no tocar»); el idioma
 * sigue directo. Sin el alta validada, todo directo como antes. La base es el respaldo
 * (`campos-nino-puerta.rls.test.ts`); aquí, que la app no mande a la base lo que va a la cola.
 */

const NINO = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'

const GUARDADA = {
  nombre: 'Lucía',
  primer_apellido: 'García',
  segundo_apellido: 'López',
  fecha_nacimiento: '2024-03-15',
  sexo: 'F' as const,
  nacionalidad: 'española',
  lugar_nacimiento: null,
  dni: null,
}

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClientMock() }))

const gate = { validada: false, registroOk: true }
const registrarSpy = vi.fn()
vi.mock('@/features/cambios-pendientes/lib/gate', () => ({
  altaValidada: () => Promise.resolve(gate.validada),
  registrarCambioPendiente: (...a: unknown[]) => {
    registrarSpy(...a)
    return Promise.resolve(
      gate.registroOk ? { ok: true } : { ok: false, error: 'admin.pendientes.errors.registro' }
    )
  },
}))

import { actualizarNinoTutor } from '../actualizar-nino-tutor'

function makeFake() {
  const rpcSpy = vi.fn()
  const fake = {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: USER } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: GUARDADA, error: null }) }),
      }),
    }),
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcSpy(fn, args)
      return Promise.resolve({ data: NINO, error: null })
    },
  }
  return { fake, rpcSpy }
}

const ENVIADO = {
  nino_id: NINO,
  nombre: GUARDADA.nombre,
  primer_apellido: GUARDADA.primer_apellido,
  segundo_apellido: GUARDADA.segundo_apellido,
  fecha_nacimiento: GUARDADA.fecha_nacimiento,
  sexo: GUARDADA.sexo,
  nacionalidad: GUARDADA.nacionalidad,
  idioma_principal: 'es' as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  gate.validada = false
  gate.registroOk = true
})

describe('actualizarNinoTutor — la puerta de identidad', () => {
  it('sin el alta validada: todo directo a la RPC, nada a la cola', async () => {
    const { fake, rpcSpy } = makeFake()
    createClientMock.mockReturnValue(fake)

    const r = await actualizarNinoTutor({ ...ENVIADO, primer_apellido: 'Garcia' })

    expect(gate.validada).toBe(false) // premisa
    expect(r).toEqual({ success: true, data: { id: NINO, pendienteValidacion: false } })
    expect(registrarSpy).not.toHaveBeenCalled()
    expect(rpcSpy).toHaveBeenCalledWith(
      'actualizar_identidad_nino_tutor',
      expect.objectContaining({ p_primer_apellido: 'Garcia', p_nombre: 'Lucía' })
    )
  })

  it('con el alta validada: el apellido que cambia va a la cola; el idioma, directo', async () => {
    gate.validada = true
    const { fake, rpcSpy } = makeFake()
    createClientMock.mockReturnValue(fake)

    const r = await actualizarNinoTutor({
      ...ENVIADO,
      primer_apellido: 'Garcia',
      idioma_principal: 'va',
    })

    expect(r).toEqual({ success: true, data: { id: NINO, pendienteValidacion: true } })
    expect(registrarSpy).toHaveBeenCalledTimes(1)
    expect(registrarSpy.mock.calls[0]![1]).toEqual({
      ninoId: NINO,
      usuarioId: USER,
      entidad: 'ninos_identidad',
      payload: { primer_apellido: 'Garcia' },
    })
    expect(rpcSpy).toHaveBeenCalledWith('actualizar_identidad_nino_tutor', {
      p_nino_id: NINO,
      p_nombre: null,
      p_primer_apellido: null,
      p_segundo_apellido: null,
      p_fecha_nacimiento: null,
      p_sexo: null,
      p_nacionalidad: null,
      p_idioma_principal: 'va',
    })
  })

  it('con el alta validada y nada cambiado: ni entrada en la cola ni «enviado»', async () => {
    gate.validada = true
    const { fake, rpcSpy } = makeFake()
    createClientMock.mockReturnValue(fake)

    const r = await actualizarNinoTutor({ ...ENVIADO })

    expect(r).toEqual({ success: true, data: { id: NINO, pendienteValidacion: false } })
    expect(registrarSpy).not.toHaveBeenCalled()
    expect(rpcSpy).toHaveBeenCalledWith(
      'actualizar_identidad_nino_tutor',
      expect.objectContaining({ p_primer_apellido: null, p_nombre: null })
    )
  })

  it('si la cola falla, no se escribe nada', async () => {
    gate.validada = true
    gate.registroOk = false
    const { fake, rpcSpy } = makeFake()
    createClientMock.mockReturnValue(fake)

    const r = await actualizarNinoTutor({ ...ENVIADO, nombre: 'Lucia' })

    expect(registrarSpy).toHaveBeenCalledTimes(1) // premisa: se intentó encolar
    expect(r).toEqual({ success: false, error: 'admin.pendientes.errors.registro' })
    expect(rpcSpy).not.toHaveBeenCalled()
  })
})
