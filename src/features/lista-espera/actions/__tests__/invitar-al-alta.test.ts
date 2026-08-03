import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * F-2b-2b — `invitarAlAlta` cableado a la RPC `crear_o_anadir_a_familia`. La acción YA NO
 * inserta niño/matrícula/perfil a mano: llama a la RPC con `p_usuario_id = NULL` (modo
 * Invitar) y, si sale bien, dispara `sendInvitation`. Estos tests fijan el flujo NUEVO:
 *  - retorno 'familia_creada'/'nino_anadido' → sendInvitation + `estado='invitado'`.
 *  - retorno 'colision' → NO invita, devuelve el aviso a Dirección.
 *  - la RPC se invoca SIEMPRE con `p_usuario_id: null` (para no crear rol al invitar).
 *
 * Se mockea el cliente Supabase (server) con un builder thenable, `getCentroActualId`,
 * `sendInvitation` y `llamarGoTrue` (que aquí solo envuelve `auth.getUser`).
 */

const CENTRO = '33333333-3333-4333-8333-333333333333'
const AULA = '44444444-4444-4444-8444-444444444444'
const PROSPECTO = '55555555-5555-4555-8555-555555555555'
const CURSO = '66666666-6666-4666-8666-666666666666'
const NINO = '22222222-2222-4222-8222-222222222222'

// Configurable por test: lo que devuelve la RPC de alta.
let rpcAltaResult: { data: unknown; error: unknown }

// Configurable por test para el GUARDARRAÍL F-2b-4-3 (cliente service-role):
//  - `authUsersList`: filas auth.users que resuelve la RPC `buscar_auth_user_por_email`
//                     (match EXACTO por email — FIX B #261, antes `listUsers`).
//  - `rolesResult`  : filas `roles_usuario` activas del tutor (≥1 → cuenta 'real').
let authUsersList: Array<{ id: string; email: string }>
let rolesResult: Array<{ usuario_id: string }>

// Fixtures del camino FIX A (#262) "el tutor YA existe" — los lee
// `vincularHijoATutorExistente`: su perfil en el centro y el vínculo del que hereda parentesco.
let perfilTutor: { nombre_completo: string; email: string } | null
let vinculoPrevio: { parentesco: string; descripcion_parentesco: string | null } | null

const PROSPECTO_ROW = {
  id: PROSPECTO,
  centro_id: CENTRO,
  nombre_nino: 'Niño Demo',
  apellidos_nino: 'Apellido Demo',
  fecha_nacimiento: '2024-01-01',
  email_tutor: 'tutor@nido.test',
  estado: 'en_espera',
}

// Firma del mock de `sendInvitation` (Result de la action). Tipar el spy con la firma
// explícita lo hace callable en el typecheck estricto del CI (evita TS2348 al llamarlo).
type SendInvitationFn = (
  ...args: unknown[]
) => Promise<{ success: boolean; data?: { invitationId: string }; error?: string }>

let sendInvitationSpy: ReturnType<typeof vi.fn<SendInvitationFn>>
let rpcSpy: ReturnType<typeof vi.fn>
let estadoUpdateSpy: ReturnType<typeof vi.fn<() => void>>

function makeServerFake() {
  function builder(table: string) {
    const state = { table, op: 'select' as 'select' | 'update' }
    const result = () => {
      if (table === 'roles_usuario')
        return { data: [{ rol: 'admin', centro_id: CENTRO }], error: null }
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

// Cliente service-role del guardarraíl: RPC `buscar_auth_user_por_email` + lectura de
// `roles_usuario`.
//
// FIX B (#261): la detección de la cuenta dejó de hacerse con `auth.admin.listUsers()` (sin
// paginar: solo veía la 1.ª página de 50) y pasó a la RPC service-role
// `buscar_auth_user_por_email`, que hace búsqueda EXACTA por email. El doble replica esa
// forma — `.rpc(...).maybeSingle()` → `{ data: fila | null }` — resolviendo contra el mismo
// fixture `authUsersList`, que sigue representando las filas de `auth.users`.
function makeServiceFake() {
  function builder(table: string) {
    const result = () => {
      if (table === 'roles_usuario') return { data: rolesResult, error: null }
      // FIX A (#262): con cuenta REAL, `vincularHijoATutorExistente` lee el perfil del tutor
      // en el centro (nombre EXACTO + email, anti-colisión) y su vínculo previo (parentesco
      // heredado del 1.er hijo).
      if (table === 'familia_tutores') return { data: perfilTutor, error: null }
      if (table === 'vinculos_familiares') return { data: vinculoPrevio, error: null }
      return { data: null, error: null }
    }
    const b: Record<string, unknown> = {}
    const self = () => b as never
    b.select = () => self()
    b.eq = () => self()
    b.is = () => self()
    b.limit = () => self()
    b.order = () => self()
    b.maybeSingle = () => self()
    b.then = (resolve: (v: unknown) => void) => resolve(result())
    return b
  }
  return {
    from: (table: string) => builder(table),
    // La RPC devuelve `TABLE (id uuid, email text)`; con `.maybeSingle()`, la fila que casa
    // EXACTAMENTE por email o `null` si el email no existe en auth.users.
    rpc: vi.fn((name: string, args?: Record<string, unknown>) => ({
      maybeSingle: () =>
        Promise.resolve({
          data:
            name === 'buscar_auth_user_por_email'
              ? (authUsersList.find((u) => u.email === args?.p_email) ?? null)
              : null,
          error: null,
        }),
    })),
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(() => makeServiceFake()),
}))

vi.mock('@/features/centros/queries/get-centro-actual', () => ({
  getCentroActualId: vi.fn(() => Promise.resolve(CENTRO)),
}))

vi.mock('@/features/auth/lib/llamar-gotrue', () => ({
  // Envuelve la promesa real y nunca marca indisponible en estos tests.
  llamarGoTrue: vi.fn(async (_label: string, fn: () => Promise<{ data: unknown }>) => {
    const r = await fn()
    return { data: r.data, error: null, indisponible: false }
  }),
}))

vi.mock('@/features/auth/actions/send-invitation', () => ({
  sendInvitation: (...args: unknown[]) => sendInvitationSpy(...args),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { invitarAlAlta } from '../invitar-al-alta'

beforeEach(() => {
  rpcAltaResult = {
    data: { resultado: 'familia_creada', familia_id: 'fam-1', nino_id: NINO, colision_info: null },
    error: null,
  }
  sendInvitationSpy = vi.fn<SendInvitationFn>(() =>
    Promise.resolve({ success: true, data: { invitationId: 'inv-1' } })
  )
  estadoUpdateSpy = vi.fn<() => void>()
  // Por defecto: email SIN cuenta (clase 'nueva') → el guardarraíl no dispara.
  authUsersList = []
  rolesResult = []
  perfilTutor = { nombre_completo: 'María Tutora', email: 'tutor@nido.test' }
  vinculoPrevio = { parentesco: 'madre', descripcion_parentesco: null }
})

describe('invitarAlAlta — cableado a la RPC de familia (F-2b-2b)', () => {
  it("éxito → llama a la RPC con p_usuario_id NULL, invita y devuelve resultado 'ok'", async () => {
    const r = await invitarAlAlta({ id: PROSPECTO, aulaId: AULA }, 'es')

    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.resultado).toBe('ok')
      if (r.data.resultado === 'ok') expect(r.data.ninoId).toBe(NINO)
    }
    // La RPC de alta se invoca con p_usuario_id NULL (no crea rol al invitar).
    const altaCall = rpcSpy.mock.calls.find((c) => c[0] === 'crear_o_anadir_a_familia')
    expect(altaCall).toBeDefined()
    expect(altaCall?.[1]).toMatchObject({
      p_usuario_id: null,
      p_centro_id: CENTRO,
      p_aula_id: AULA,
    })
    // Invitación enviada + prospecto marcado invitado.
    expect(sendInvitationSpy).toHaveBeenCalledTimes(1)
    expect(estadoUpdateSpy).toHaveBeenCalledTimes(1)
  })

  it('colisión → NO invita y devuelve el aviso con el nombre existente', async () => {
    rpcAltaResult = {
      data: {
        resultado: 'colision',
        familia_id: 'fam-1',
        nino_id: null,
        colision_info: { motivo: 'nombre', nombre_existente: 'Familia García' },
      },
      error: null,
    }

    const r = await invitarAlAlta({ id: PROSPECTO, aulaId: AULA }, 'es')

    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.resultado).toBe('colision')
      if (r.data.resultado === 'colision') expect(r.data.nombreExistente).toBe('Familia García')
    }
    // NO se envía invitación ni se marca el prospecto.
    expect(sendInvitationSpy).not.toHaveBeenCalled()
    expect(estadoUpdateSpy).not.toHaveBeenCalled()
  })

  it('error de la RPC → fail, no invita', async () => {
    rpcAltaResult = { data: null, error: { message: 'boom' } }

    const r = await invitarAlAlta({ id: PROSPECTO, aulaId: AULA }, 'es')

    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('listaEspera.errors.alta_fallo')
    expect(sendInvitationSpy).not.toHaveBeenCalled()
  })
})

describe('invitarAlAlta — guardarraíl cuenta existente (F-2b-4-3)', () => {
  // FIX A (#262) cambió este escenario: con cuenta REAL ya NO se rechaza con
  // `tutor_ya_registrado_usar_anadir_hijo` — se VINCULA el hijo nuevo a la familia existente
  // del tutor (camino feliz del 2.º hijo), sin email ni invitación porque ya tiene acceso.
  it('email con cuenta REAL (con roles) → vincula el hijo a su familia, sin invitación', async () => {
    // El tutor del prospecto ya tiene cuenta operativa (fila auth + ≥1 rol activo).
    authUsersList = [{ id: 'tutor-uid', email: 'tutor@nido.test' }]
    rolesResult = [{ usuario_id: 'tutor-uid' }]

    const r = await invitarAlAlta({ id: PROSPECTO, aulaId: AULA }, 'es')

    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.resultado).toBe('vinculado')
      if (r.data.resultado === 'vinculado') expect(r.data.ninoId).toBe(NINO)
    }
    // Lo distintivo frente al flujo de invitar: la RPC lleva el `usuario_id` REAL del tutor
    // (crea rol+vínculo al vuelo), no NULL.
    const altaCall = rpcSpy.mock.calls.find((c) => c[0] === 'crear_o_anadir_a_familia')
    expect(altaCall?.[1]).toMatchObject({
      p_usuario_id: 'tutor-uid',
      p_centro_id: CENTRO,
      p_aula_id: AULA,
      // Nombre EXACTO del perfil guardado → el chequeo de colisión de la RPC queda inerte.
      p_tutor_nombre_completo: 'María Tutora',
      // Parentesco heredado del vínculo previo (mismo tutor, hermano anterior).
      p_parentesco: 'madre',
    })
    // Ya tiene acceso: no se manda invitación. El prospecto sí sale de la cola.
    expect(sendInvitationSpy).not.toHaveBeenCalled()
    expect(estadoUpdateSpy).toHaveBeenCalledTimes(1)
  })

  it('email con cuenta STUB (fila auth sin roles) → sigue el flujo de invitación normal (RPC con p_usuario_id NULL)', async () => {
    // Existe la fila auth (p. ej. de un invite previo) pero SIN roles → clase 'stub'.
    authUsersList = [{ id: 'stub-uid', email: 'tutor@nido.test' }]
    rolesResult = []

    const r = await invitarAlAlta({ id: PROSPECTO, aulaId: AULA }, 'es')

    expect(r.success).toBe(true)
    const altaCall = rpcSpy.mock.calls.find((c) => c[0] === 'crear_o_anadir_a_familia')
    expect(altaCall).toBeDefined()
    expect(altaCall?.[1]).toMatchObject({ p_usuario_id: null })
    expect(sendInvitationSpy).toHaveBeenCalledTimes(1)
  })

  it('email NUEVO (sin fila auth) → flujo de invitación normal (RPC con p_usuario_id NULL)', async () => {
    // authUsersList=[] por defecto → clase 'nueva' → el guardarraíl no dispara.
    const r = await invitarAlAlta({ id: PROSPECTO, aulaId: AULA }, 'es')

    expect(r.success).toBe(true)
    const altaCall = rpcSpy.mock.calls.find((c) => c[0] === 'crear_o_anadir_a_familia')
    expect(altaCall?.[1]).toMatchObject({ p_usuario_id: null })
    expect(sendInvitationSpy).toHaveBeenCalledTimes(1)
  })
})
