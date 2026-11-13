import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `guardarDatosTutor` desde la fase 6 (`20270118120000`): escribe por `guardar_tutor`, y la BASE
 * decide si va a la cola (42501 HINT `cola_validacion`, con el alta de la FAMILIA validada). Solo
 * entonces la acción lee lo guardado (`tutores_de_familia`) y encola lo que CAMBIA, con el payload
 * ENTERO (al aprobar se escriben todos los campos, `aplicar.ts`). Mandar lo mismo no es un cambio: la
 * base no devuelve la cola y no se escribe nada.
 */

const USER = '11111111-1111-4111-8111-111111111111'
const NINO = '22222222-2222-4222-8222-222222222222'
const FAMILIA = '33333333-3333-4333-8333-333333333333'
const FILA = '44444444-4444-4444-8444-444444444444'

const GUARDADO = {
  email: 'madre@ejemplo.invalid',
  nombre_completo: 'Madre Demo',
  direccion_calle: 'Mayor',
  direccion_numero: '1',
  direccion_cp: '46001',
  direccion_ciudad: 'Valencia',
  telefono: '+34600000001',
  fecha_nacimiento: '1985-01-01',
  dni_numero: '12345678Z',
  estudios: null,
  empresa: null,
}

const registrarSpy = vi.fn()
vi.mock('@/features/cambios-pendientes/lib/gate', () => ({
  registrarCambioPendiente: (...a: unknown[]) => {
    registrarSpy(...a)
    return Promise.resolve({ ok: true })
  },
}))
vi.mock('@/shared/lib/logger', () => ({ logger: { warn: vi.fn() } }))

const base: {
  guardar: { data: string | null; error: { code: string; hint?: string; message?: string } | null }
  leidos: { data: Array<Record<string, unknown>> | null; error: { code: string } | null }
} = { guardar: { data: FILA, error: null }, leidos: { data: [], error: null } }
const rpcs: Array<[string, Record<string, unknown>]> = []

vi.mock('@/lib/supabase/server', () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: USER } } }) },
      from: () => {
        const q = {
          select: () => q,
          eq: () => q,
          maybeSingle: () => Promise.resolve({ data: { familia_id: FAMILIA }, error: null }),
        }
        return q
      },
      rpc: (nombre: string, args: Record<string, unknown>) => {
        rpcs.push([nombre, args])
        return Promise.resolve(nombre === 'guardar_tutor' ? base.guardar : base.leidos)
      },
    }),
}))

import { guardarDatosTutor } from '../guardar-datos-tutor'

const ENTRADA = { nino_id: NINO, tipo_vinculo: 'tutor_legal_principal' as const, ...GUARDADO }
const COLA = {
  data: null,
  error: { code: '42501', hint: 'cola_validacion', message: 'alta validada' },
}
const filaGuardada = (extra: Record<string, unknown> = {}) => ({
  id: FILA,
  rol_familia: 'titular',
  ve_personales: true,
  ...GUARDADO,
  ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  rpcs.length = 0
  base.guardar = { data: FILA, error: null }
  base.leidos = { data: [filaGuardada()], error: null }
})

describe('guardarDatosTutor — la base decide la cola', () => {
  it('escribe por guardar_tutor, en SU familia y su rol, con los once campos', async () => {
    const r = await guardarDatosTutor(ENTRADA)
    expect(r).toEqual({ success: true, data: { id: FILA } })
    expect(rpcs).toHaveLength(1)
    const [nombre, args] = rpcs[0]!
    expect(nombre).toBe('guardar_tutor')
    expect(args).toMatchObject({ p_familia_id: FAMILIA, p_rol_familia: 'titular' })
    expect(Object.keys(args.p_datos as object).sort()).toEqual(Object.keys(GUARDADO).sort())
    expect(registrarSpy).not.toHaveBeenCalled()
  })

  it('el teléfono va normalizado y el documento en mayúsculas', async () => {
    await guardarDatosTutor({ ...ENTRADA, telefono: '0034 600-11-22-33', dni_numero: 'p1234567' })
    expect(rpcs[0]![1].p_datos).toMatchObject({ telefono: '+34600112233', dni_numero: 'P1234567' })
  })

  it('con la cola: cambia el email → una entrada con el payload ENTERO', async () => {
    base.guardar = COLA
    const r = await guardarDatosTutor({ ...ENTRADA, email: 'otra@ejemplo.invalid' })
    expect(r).toEqual({ success: true, data: { pendienteValidacion: true } })
    expect(registrarSpy).toHaveBeenCalledTimes(1)
    expect(registrarSpy.mock.calls[0]![1]).toEqual({
      ninoId: NINO,
      usuarioId: USER,
      entidad: 'datos_tutor',
      payload: {
        tipo_vinculo: 'tutor_legal_principal',
        ...GUARDADO,
        email: 'otra@ejemplo.invalid',
      },
    })
  })

  it('con la cola y nada que cambie respecto a lo guardado → ni entrada ni error', async () => {
    base.guardar = COLA
    const r = await guardarDatosTutor(ENTRADA)
    expect(r).toEqual({ success: true, data: {} })
    expect(registrarSpy).not.toHaveBeenCalled()
  })

  it('con la cola y sin perfil guardado, lo que trae valor es un cambio', async () => {
    base.guardar = COLA
    base.leidos = { data: [], error: null }
    const r = await guardarDatosTutor(ENTRADA)
    expect(r).toEqual({ success: true, data: { pendienteValidacion: true } })
  })

  it('con la cola y sin poder leer lo guardado (error o sin permiso) → error, sin cola', async () => {
    base.guardar = COLA
    base.leidos = { data: null, error: { code: '42501' } }
    expect(await guardarDatosTutor({ ...ENTRADA, email: 'otra@ejemplo.invalid' })).toEqual({
      success: false,
      error: 'alta.documentos.errors.guardado',
    })
    base.leidos = { data: [filaGuardada({ ve_personales: false })], error: null }
    expect(await guardarDatosTutor({ ...ENTRADA, email: 'otra@ejemplo.invalid' })).toEqual({
      success: false,
      error: 'alta.documentos.errors.guardado',
    })
    expect(registrarSpy).not.toHaveBeenCalled()
  })

  it('lo que rechaza la base vuelve con su mensaje', async () => {
    const casos: Array<[{ code: string; hint?: string; message?: string }, string]> = [
      [{ code: '42501' }, 'alta.errors.no_autorizado'],
      [
        { code: '23514', message: 'familia_tutores_telefono_formato' },
        'alta.tutor.errors.telefono',
      ],
      [
        { code: '23514', message: 'familia_tutores_dni_numero_valido' },
        'alta.tutor.errors.dni_numero',
      ],
      [
        { code: '23514', hint: 'fecha_nacimiento_fuera_de_rango' },
        'alta.tutor.errors.fecha_nacimiento',
      ],
    ]
    for (const [error, mensaje] of casos) {
      base.guardar = { data: null, error }
      expect(await guardarDatosTutor(ENTRADA), mensaje).toEqual({ success: false, error: mensaje })
    }
  })

  it('las validaciones de la forma no dejan fuera a una familia real', async () => {
    const pasa = async (extra: Record<string, unknown>) =>
      (await guardarDatosTutor({ ...ENTRADA, ...extra })).success
    expect(await pasa({ telefono: '+44 20 7946 0958' })).toBe(true)
    expect(await pasa({ dni_numero: 'X1234567L' })).toBe(true)
    expect(await pasa({ dni_numero: 'AB123456' })).toBe(true) // pasaporte extranjero
    expect(await pasa({ fecha_nacimiento: '2010-01-01' })).toBe(true) // menor de edad
    expect(await pasa({ telefono: '1234' })).toBe(false)
    expect(await pasa({ dni_numero: '12345678A' })).toBe(false)
    expect(await pasa({ fecha_nacimiento: '1850-01-01' })).toBe(false)
  })
})
