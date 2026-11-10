import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `guardarDatosTutor` con el alta YA validada (2026-11-08): los datos del tutor van a la cola de
 * Dirección solo si algo CAMBIA respecto a lo guardado en `familia_tutores`. Sin comparar, cada vez
 * que se guardaba el paso se encolaba una entrada aunque no se hubiera tocado nada. Si algo cambia,
 * el payload va ENTERO (al aprobar se escriben los seis campos, `aplicar.ts`).
 */

const USER = '11111111-1111-4111-8111-111111111111'
const NINO = '22222222-2222-4222-8222-222222222222'
const FAMILIA = '33333333-3333-4333-8333-333333333333'

const GUARDADO = {
  email: 'madre@ejemplo.invalid',
  nombre_completo: 'Madre Demo',
  direccion_calle: 'Mayor',
  direccion_numero: '1',
  direccion_cp: '46001',
  direccion_ciudad: 'Valencia',
}

const gate = { validada: true }
const registrarSpy = vi.fn()
vi.mock('@/features/cambios-pendientes/lib/gate', () => ({
  altaValidada: () => Promise.resolve(gate.validada),
  registrarCambioPendiente: (...a: unknown[]) => {
    registrarSpy(...a)
    return Promise.resolve({ ok: true })
  },
}))
vi.mock('@/shared/lib/logger', () => ({ logger: { warn: vi.fn() } }))

const lectura: { guardado: typeof GUARDADO | null; error: { code: string } | null } = {
  guardado: GUARDADO,
  error: null,
}
const filtros: Array<[string, string, unknown]> = []
const escrituras: string[] = []

/** Cadena de PostgREST: cada filtro se apunta; `maybeSingle` devuelve según la tabla. */
function consulta(tabla: string) {
  const q = {
    select: () => q,
    eq: (col: string, v: unknown) => (filtros.push([tabla, col, v]), q),
    is: (col: string, v: unknown) => (filtros.push([tabla, col, v]), q),
    update: () => (escrituras.push(`update:${tabla}`), q),
    insert: () => (escrituras.push(`insert:${tabla}`), q),
    maybeSingle: () =>
      Promise.resolve(
        tabla === 'ninos'
          ? { data: { familia_id: FAMILIA }, error: null }
          : { data: lectura.guardado, error: lectura.error }
      ),
  }
  return q
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: USER } } }) },
      from: (tabla: string) => consulta(tabla),
    }),
}))

import { guardarDatosTutor } from '../guardar-datos-tutor'

const ENTRADA = {
  nino_id: NINO,
  tipo_vinculo: 'tutor_legal_principal' as const,
  ...GUARDADO,
}

beforeEach(() => {
  vi.clearAllMocks()
  gate.validada = true
  lectura.guardado = GUARDADO
  lectura.error = null
  filtros.length = 0
  escrituras.length = 0
})

describe('guardarDatosTutor — alta validada: solo lo que cambia va a la cola', () => {
  it('nada cambia → ni entrada en la cola ni escritura', async () => {
    const r = await guardarDatosTutor(ENTRADA)

    // Premisa: se ha leído lo guardado del titular de SU familia (si no, «nada cambia» sería vacío).
    expect(filtros).toContainEqual(['familia_tutores', 'familia_id', FAMILIA])
    expect(filtros).toContainEqual(['familia_tutores', 'rol_familia', 'titular'])
    expect(r).toEqual({ success: true, data: {} })
    expect(registrarSpy).not.toHaveBeenCalled()
    expect(escrituras).toEqual([])
  })

  it('cambia el email → una entrada con el payload ENTERO, y nada escrito directo', async () => {
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
    expect(escrituras).toEqual([])
  })

  it('sin perfil guardado, lo que trae valor es un cambio → a la cola', async () => {
    lectura.guardado = null
    const r = await guardarDatosTutor(ENTRADA)

    expect(r).toEqual({ success: true, data: { pendienteValidacion: true } })
    expect(registrarSpy).toHaveBeenCalledTimes(1)
  })

  it('si no se puede leer lo guardado → error, ni cola ni escritura', async () => {
    lectura.error = { code: '42501' }
    const r = await guardarDatosTutor({ ...ENTRADA, email: 'otra@ejemplo.invalid' })

    expect(r).toEqual({ success: false, error: 'alta.documentos.errors.guardado' })
    expect(registrarSpy).not.toHaveBeenCalled()
    expect(escrituras).toEqual([])
  })
})
