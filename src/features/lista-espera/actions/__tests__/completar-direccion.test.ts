import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * F-2b-2d — tests de `completarEnDireccion` (alta modo Dirección, ya cableado a la RPC
 * `crear_o_anadir_a_familia` en #189/F-2b-2a). A diferencia de invitar: la cuenta del tutor
 * queda ACTIVA con rol desde el inicio (`crearTutorDirecto` → createUser) y su `usuario_id`
 * REAL se pasa a la RPC en el INSERT del perfil — no hay stub, ni aceptación, ni backfill.
 *
 * Cubre: éxito ('familia_creada' y 'nino_anadido'), colisión (patrón PR-A, no traga, sin
 * actualizar estado), fallo de cuenta (no llega a la RPC), fallo de RPC tras cuenta creada
 * (sin compensación — comportamiento ratificado), y authz (no-admin rechazado antes de nada).
 *
 * Se mockea el cliente Supabase (server) con un builder thenable, `getCentroActualId`,
 * `createServiceRoleClient`, `crearTutorDirecto` y `llamarGoTrue` (envuelve `auth.getUser`).
 */

const CENTRO = '33333333-3333-4333-8333-333333333333'
const AULA = '44444444-4444-4444-8444-444444444444'
const PROSPECTO = '55555555-5555-4555-8555-555555555555'
const CURSO = '66666666-6666-4666-8666-666666666666'
const NINO = '22222222-2222-4222-8222-222222222222'

// Configurables por test.
let rolesFixture: Array<{ rol: string; centro_id: string }>
let rpcAltaResult: { data: unknown; error: unknown }

const PROSPECTO_ROW = {
  id: PROSPECTO,
  centro_id: CENTRO,
  nombre_nino: 'Niño Demo',
  apellidos_nino: 'Apellido Demo',
  fecha_nacimiento: '2024-01-01',
  estado: 'en_espera',
}

// Firma del mock de `crearTutorDirecto` (Result de la lib). Tipar el spy con la firma
// explícita lo hace callable en el typecheck estricto del CI (evita TS2348 al llamarlo).
type CrearTutorFn = (
  ...args: unknown[]
) => Promise<{ success: boolean; data?: { usuarioId: string }; error?: string }>

let crearTutorSpy: ReturnType<typeof vi.fn<CrearTutorFn>>
let rpcSpy: ReturnType<typeof vi.fn>
let estadoUpdateSpy: ReturnType<typeof vi.fn<() => void>>

function makeServerFake() {
  function builder(table: string) {
    const state = { table, op: 'select' as 'select' | 'update' }
    const result = () => {
      if (table === 'roles_usuario') return { data: rolesFixture, error: null }
      if (table === 'aulas_curso') return { data: { aula_id: AULA }, error: null }
      if (table === 'lista_espera') {
        if (state.op === 'update') {
          estadoUpdateSpy()
          return { data: null, error: null }
        }
        return { data: PROSPECTO_ROW, error: null }
      }
      return { data: null, error: null }
    }
    const b: Record<string, unknown> = {}
    const self = () => b as never
    b.select = () => self()
    b.update = () => {
      state.op = 'update'
      return self()
    }
    b.eq = () => self()
    b.is = () => self()
    b.maybeSingle = () => self()
    b.then = (resolve: (v: unknown) => void) => resolve(result())
    return b
  }
  rpcSpy = vi.fn((name: string) => {
    if (name === 'curso_activo_de_centro') return Promise.resolve({ data: CURSO, error: null })
    if (name === 'crear_o_anadir_a_familia') return Promise.resolve(rpcAltaResult)
    return Promise.resolve({ data: null, error: null })
  })
  return {
    from: (table: string) => builder(table),
    rpc: rpcSpy,
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: { id: 'admin-id' } }, error: null })),
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(makeServerFake())),
}))

vi.mock('@/lib/supabase/admin', () => ({
  // El service client solo se pasa a `crearTutorDirecto` (mockeado) → basta un objeto vacío.
  createServiceRoleClient: vi.fn(() => ({})),
}))

vi.mock('@/features/centros/queries/get-centro-actual', () => ({
  getCentroActualId: vi.fn(() => Promise.resolve(CENTRO)),
}))

vi.mock('@/features/auth/lib/llamar-gotrue', () => ({
  llamarGoTrue: vi.fn(async (_label: string, fn: () => Promise<{ data: unknown }>) => {
    const r = await fn()
    return { data: r.data, error: null, indisponible: false }
  }),
}))

vi.mock('@/features/auth/lib/crear-tutor-directo', () => ({
  crearTutorDirecto: (...args: unknown[]) => crearTutorSpy(...args),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { completarEnDireccion } from '../completar-direccion'

const VALID_INPUT = {
  id: PROSPECTO,
  aulaId: AULA,
  nombreTutor: 'María',
  apellidosTutor: 'Tutora Demo',
  email: 'tutor@nido.test',
  password: 'Password1234!',
  parentesco: 'madre' as const,
  descripcionParentesco: null,
}

/** Helper: ¿se llamó a la RPC de alta de familia? */
function altaRpcCall() {
  return rpcSpy.mock.calls.find((c) => c[0] === 'crear_o_anadir_a_familia')
}

beforeEach(() => {
  rolesFixture = [{ rol: 'admin', centro_id: CENTRO }]
  rpcAltaResult = {
    data: { resultado: 'familia_creada', familia_id: 'fam-1', nino_id: NINO, colision_info: null },
    error: null,
  }
  crearTutorSpy = vi.fn<CrearTutorFn>(() =>
    Promise.resolve({ success: true, data: { usuarioId: 'tutor-id' } })
  )
  estadoUpdateSpy = vi.fn<() => void>()
})

describe('completarEnDireccion — alta modo Dirección con la RPC de familia', () => {
  it("éxito 'familia_creada' → cuenta creada, RPC con usuario_id real, estado actualizado, ok", async () => {
    const r = await completarEnDireccion(VALID_INPUT, 'es')

    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.resultado).toBe('ok')
      if (r.data.resultado === 'ok') {
        expect(r.data.ninoId).toBe(NINO)
        expect(r.data.usuarioId).toBe('tutor-id')
      }
    }
    // La cuenta se crea PRIMERO; su usuario_id REAL viaja a la RPC (no NULL como en invitar).
    expect(crearTutorSpy).toHaveBeenCalledTimes(1)
    expect(altaRpcCall()?.[1]).toMatchObject({
      p_usuario_id: 'tutor-id',
      p_centro_id: CENTRO,
      p_aula_id: AULA,
    })
    // El prospecto sale de la cola.
    expect(estadoUpdateSpy).toHaveBeenCalledTimes(1)
  })

  it("éxito 'nino_anadido' (2.º hijo, familia existente) → ok con el niño", async () => {
    rpcAltaResult = {
      data: { resultado: 'nino_anadido', familia_id: 'fam-1', nino_id: NINO, colision_info: null },
      error: null,
    }

    const r = await completarEnDireccion(VALID_INPUT, 'es')

    expect(r.success).toBe(true)
    if (r.success && r.data.resultado === 'ok') expect(r.data.ninoId).toBe(NINO)
    expect(estadoUpdateSpy).toHaveBeenCalledTimes(1)
  })

  it("colisión → ok({resultado:'colision', nombreExistente}), NO actualiza estado, no traga", async () => {
    rpcAltaResult = {
      data: {
        resultado: 'colision',
        familia_id: 'fam-1',
        nino_id: null,
        colision_info: { motivo: 'nombre', nombre_existente: 'Familia García' },
      },
      error: null,
    }

    const r = await completarEnDireccion(VALID_INPUT, 'es')

    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.resultado).toBe('colision')
      if (r.data.resultado === 'colision') expect(r.data.nombreExistente).toBe('Familia García')
    }
    // La cuenta ya se creó antes de detectar la colisión (se reutiliza en el reintento).
    expect(crearTutorSpy).toHaveBeenCalledTimes(1)
    // NO se saca al prospecto de la cola.
    expect(estadoUpdateSpy).not.toHaveBeenCalled()
  })

  it('fallo de cuenta (crearTutorDirecto falla) → fail, NO llama a la RPC', async () => {
    crearTutorSpy = vi.fn<CrearTutorFn>(() =>
      Promise.resolve({ success: false, error: 'auth.invitation.errors.create_failed' })
    )

    const r = await completarEnDireccion(VALID_INPUT, 'es')

    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('auth.invitation.errors.create_failed')
    expect(altaRpcCall()).toBeUndefined()
    expect(estadoUpdateSpy).not.toHaveBeenCalled()
  })

  it('fallo de RPC tras cuenta creada → fail alta_fallo, sin compensación', async () => {
    rpcAltaResult = { data: null, error: { message: 'boom' } }

    const r = await completarEnDireccion(VALID_INPUT, 'es')

    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('listaEspera.errors.alta_fallo')
    // La cuenta se creó (comportamiento actual: no se borra; reintento idempotente).
    expect(crearTutorSpy).toHaveBeenCalledTimes(1)
    expect(estadoUpdateSpy).not.toHaveBeenCalled()
  })

  it('no-admin → forbidden antes de tocar cuenta o RPC', async () => {
    rolesFixture = [{ rol: 'profe', centro_id: CENTRO }]

    const r = await completarEnDireccion(VALID_INPUT, 'es')

    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('auth.invitation.errors.forbidden')
    expect(crearTutorSpy).not.toHaveBeenCalled()
    expect(altaRpcCall()).toBeUndefined()
  })
})
