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
  lugar_nacimiento: 'Valencia',
  dni: null,
}

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClientMock() }))

const gate = { validada: false, registroOk: true }
// Quién es Dirección lo decide el servidor (`esAdminDeCentroDeNino`); aquí, controlable.
const direccion = { es: false }
vi.mock('@/features/alta/lib/authz-tutor', () => ({
  esAdminDeCentroDeNino: () => Promise.resolve(direccion.es),
}))
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

function makeFake(
  update: { data: { id: string } | null; error: { code: string } | null } = {
    data: { id: NINO },
    error: null,
  }
) {
  const rpcSpy = vi.fn()
  const updateSpy = vi.fn()
  const fake = {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: USER } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: GUARDADA, error: null }) }),
      }),
      update: (patch: Record<string, unknown>) => {
        updateSpy(patch)
        return {
          eq: () => ({ select: () => ({ maybeSingle: () => Promise.resolve(update) }) }),
        }
      },
    }),
    rpc: (fn: string, args: Record<string, unknown>) => {
      // Lo de gestión (el DNI guardado) sale por su función desde `20270115130000`; no es una
      // escritura, así que no cuenta como «RPC» en los asertos de este fichero.
      if (fn === 'ficha_gestion_ninos')
        return Promise.resolve({ data: [{ nino_id: NINO, dni: GUARDADA.dni }], error: null })
      rpcSpy(fn, args)
      return Promise.resolve({ data: NINO, error: null })
    },
  }
  return { fake, rpcSpy, updateSpy }
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
  lugar_nacimiento: GUARDADA.lugar_nacimiento,
  dni: '',
  hermanos_total: 2,
  hermanos_lugar: 1,
}

beforeEach(() => {
  vi.clearAllMocks()
  gate.validada = false
  gate.registroOk = true
  direccion.es = false
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
      p_lugar_nacimiento: null,
      p_dni: null,
      p_idioma_principal: 'va',
      p_hermanos_total: 2,
      p_hermanos_lugar: 1,
      p_observaciones_familia: null,
      p_como_nos_conocio: null,
      p_como_nos_conocio_otro: null,
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

describe('actualizarNinoTutor — fase 5b', () => {
  it('con el alta validada, el lugar de nacimiento que cambia va a la cola; los hermanos, directos', async () => {
    gate.validada = true
    const { fake, rpcSpy } = makeFake()
    createClientMock.mockReturnValue(fake)

    const r = await actualizarNinoTutor({
      ...ENVIADO,
      lugar_nacimiento: ' Alzira ',
      hermanos_total: 3,
      hermanos_lugar: 3,
    })

    expect(direccion.es).toBe(false) // premisa: es la tutora
    expect(r).toEqual({ success: true, data: { id: NINO, pendienteValidacion: true } })
    expect(registrarSpy.mock.calls[0]![1]).toMatchObject({
      payload: { lugar_nacimiento: 'Alzira' },
    })
    expect(rpcSpy).toHaveBeenCalledWith(
      'actualizar_identidad_nino_tutor',
      expect.objectContaining({
        p_lugar_nacimiento: null,
        p_hermanos_total: 3,
        p_hermanos_lugar: 3,
      })
    )
  })

  it('«cómo nos conoció» que no es «otro» no manda texto de «otro»', async () => {
    const { fake, rpcSpy } = makeFake()
    createClientMock.mockReturnValue(fake)

    await actualizarNinoTutor({
      ...ENVIADO,
      como_nos_conocio: 'internet',
      como_nos_conocio_otro: 'esto no se guarda',
    })

    expect(rpcSpy).toHaveBeenCalledWith(
      'actualizar_identidad_nino_tutor',
      expect.objectContaining({ p_como_nos_conocio: 'internet', p_como_nos_conocio_otro: null })
    )
  })

  it('el esquema rechaza un lugar en la fila de hermanos mayor que el total, y «otro» sin texto', async () => {
    const { fake, rpcSpy } = makeFake()
    createClientMock.mockReturnValue(fake)

    const a = await actualizarNinoTutor({ ...ENVIADO, hermanos_total: 2, hermanos_lugar: 3 })
    const b = await actualizarNinoTutor({
      ...ENVIADO,
      como_nos_conocio: 'otro',
      como_nos_conocio_otro: ' ',
    })
    const c = await actualizarNinoTutor({ ...ENVIADO, dni: '12345678A' })

    expect(a).toEqual({ success: false, error: 'nino.validation.hermanos_lugar_mayor' })
    expect(b).toEqual({ success: false, error: 'nino.validation.como_nos_conocio_otro_requerido' })
    expect(c).toEqual({ success: false, error: 'nino.validation.dni_invalido' })
    expect(rpcSpy).not.toHaveBeenCalled()
  })
})

describe('actualizarNinoTutor — modo Dirección (alta en papel)', () => {
  it('Dirección escribe la ficha con su sesión: ni la función de la tutora ni la cola', async () => {
    direccion.es = true
    gate.validada = true // ni con el alta validada: Dirección no se valida a sí misma
    const { fake, rpcSpy, updateSpy } = makeFake()
    createClientMock.mockReturnValue(fake)

    const r = await actualizarNinoTutor({
      ...ENVIADO,
      primer_apellido: 'Garcia',
      dni: '12.345.678-z',
      observaciones_familia: '  ',
    })

    expect(direccion.es).toBe(true) // premisa
    expect(r).toEqual({ success: true, data: { id: NINO, pendienteValidacion: false } })
    expect(rpcSpy).not.toHaveBeenCalled()
    expect(registrarSpy).not.toHaveBeenCalled()
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        primer_apellido: 'Garcia',
        segundo_apellido: 'López',
        dni: '12345678Z',
        lugar_nacimiento: 'Valencia',
        hermanos_total: 2,
        hermanos_lugar: 1,
        observaciones_familia: null,
      })
    )
  })

  it('si la RLS no la deja escribir (0 filas), no dice «guardado»', async () => {
    direccion.es = true
    const { fake } = makeFake({ data: null, error: null })
    createClientMock.mockReturnValue(fake)

    expect(await actualizarNinoTutor({ ...ENVIADO })).toEqual({
      success: false,
      error: 'nino.errors.no_autorizado',
    })
  })

  it('un CHECK de la base (23514) es un dato inválido, no un fallo genérico', async () => {
    direccion.es = true
    const { fake } = makeFake({ data: null, error: { code: '23514' } })
    createClientMock.mockReturnValue(fake)

    expect(await actualizarNinoTutor({ ...ENVIADO })).toEqual({
      success: false,
      error: 'nino.validation.invalid',
    })
  })

  it('la tutora no entra por este camino: va a la función, que mira es_tutor_legal_de', async () => {
    const { fake, rpcSpy, updateSpy } = makeFake()
    createClientMock.mockReturnValue(fake)

    await actualizarNinoTutor({ ...ENVIADO })

    expect(direccion.es).toBe(false) // premisa
    expect(updateSpy).not.toHaveBeenCalled()
    expect(rpcSpy).toHaveBeenCalledTimes(1)
  })
})
