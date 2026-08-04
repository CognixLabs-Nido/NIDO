import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * U-2 — "Añadir hijo a familia existente" crea un PROSPECTO, no el niño.
 *
 * Lo que fija este test es justo la regresión que motivó U-2: antes esta vía llamaba a la RPC
 * `crear_o_anadir_a_familia` y el 2.º hijo nacía con niño + matrícula pero SIN pasar por
 * admisiones (se perdía de la lista). Ahora inserta en `lista_espera` con el `tutor_usuario_id`
 * del titular (D1) y no toca la RPC.
 */

const CENTRO = '33333333-3333-4333-8333-333333333333'
const CURSO = '66666666-6666-4666-8666-666666666666'
const FAMILIA = '11111111-1111-4111-8111-111111111111'
const TUTOR = '99999999-9999-4999-8999-999999999999'

// Configurables por test.
let familiaRow: { id: string; centro_id: string } | null
let tutoresRows: Array<{
  usuario_id: string | null
  nombre_completo: string | null
  email: string | null
  rol_familia: string | null
}>
let ultimaPosicion: { posicion: number } | null
let insertErr: { message: string } | null

let rpcSpy: ReturnType<typeof vi.fn>
// Firma explícita: se invoca directamente en el builder (evita TS2348 en el typecheck).
type InsertFn = (tabla: string, payload: unknown) => void
let insertSpy: ReturnType<typeof vi.fn<InsertFn>>

/** Cliente AUTENTICADO: gate admin, curso activo, cola y el INSERT del prospecto. */
function makeServerFake() {
  function builder(table: string) {
    const b: Record<string, unknown> = {}
    const self = () => b as never
    const result = () => {
      if (table === 'roles_usuario')
        return { data: [{ rol: 'admin', centro_id: CENTRO }], error: null }
      if (table === 'lista_espera') return { data: ultimaPosicion, error: null }
      return { data: null, error: null }
    }
    b.select = () => self()
    b.eq = () => self()
    b.is = () => self()
    b.order = () => self()
    b.limit = () => self()
    b.maybeSingle = () => self()
    // `.insert(...).select('id').single()` → devuelve la fila creada (o el error inyectado).
    b.insert = (payload: unknown) => {
      insertSpy(table, payload)
      return {
        select: () => ({
          single: () =>
            Promise.resolve(
              insertErr
                ? { data: null, error: insertErr }
                : { data: { id: 'prospecto-1' }, error: null }
            ),
        }),
      } as never
    }
    b.then = (resolve: (v: unknown) => void) => resolve(result())
    return b
  }
  rpcSpy = vi.fn((name: string) => {
    if (name === 'curso_activo_de_centro') return Promise.resolve({ data: CURSO, error: null })
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

/** Cliente service-role: familia del centro + adultos de la familia. */
function makeServiceFake() {
  function builder(table: string) {
    const b: Record<string, unknown> = {}
    const self = () => b as never
    const result = () => {
      if (table === 'familias') return { data: familiaRow, error: null }
      if (table === 'familia_tutores') return { data: tutoresRows, error: null }
      return { data: null, error: null }
    }
    b.select = () => self()
    b.eq = () => self()
    b.is = () => self()
    b.maybeSingle = () => self()
    b.then = (resolve: (v: unknown) => void) => resolve(result())
    return b
  }
  return { from: (table: string) => builder(table) }
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(makeServerFake())),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(() => makeServiceFake()),
}))
vi.mock('@/features/centros/queries/get-centro-actual', () => ({
  getCentroActualId: vi.fn(() => Promise.resolve(CENTRO)),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { anadirHijoAFamilia } from '../anadir-hijo-a-familia'

const VALID_INPUT = {
  familia_id: FAMILIA,
  nombre: 'Niño Demo 2',
  apellidos: 'Hermano Segundo',
  fecha_nacimiento: '2025-03-01',
}

beforeEach(() => {
  familiaRow = { id: FAMILIA, centro_id: CENTRO }
  tutoresRows = [
    {
      usuario_id: TUTOR,
      nombre_completo: 'María Tutora',
      email: 'tutora@nido.test',
      rol_familia: 'titular',
    },
  ]
  ultimaPosicion = { posicion: 7 }
  insertErr = null
  insertSpy = vi.fn<InsertFn>()
})

describe('anadirHijoAFamilia — U-2: el 2.º hijo nace como PROSPECTO', () => {
  it('crea el prospecto en el curso activo con el tutor_usuario_id del titular (D1)', async () => {
    const r = await anadirHijoAFamilia(VALID_INPUT)

    expect(r.success).toBe(true)
    if (r.success) expect(r.data.prospectoId).toBe('prospecto-1')

    expect(insertSpy).toHaveBeenCalledTimes(1)
    const [tabla, payload] = insertSpy.mock.calls[0]!
    expect(tabla).toBe('lista_espera')
    expect(payload).toMatchObject({
      curso_academico_id: CURSO,
      nombre_nino: 'Niño Demo 2',
      apellidos_nino: 'Hermano Segundo',
      fecha_nacimiento: '2025-03-01',
      // D1: la cuenta EXACTA del tutor viaja en el prospecto…
      tutor_usuario_id: TUTOR,
      // …y el email queda como dato de contacto (ya no hace falta para detectar).
      email_tutor: 'tutora@nido.test',
      // Al final de la cola del curso (7 + 1).
      posicion: 8,
    })
  })

  it('NO crea niño ni matrícula: la RPC de alta no se invoca', async () => {
    await anadirHijoAFamilia(VALID_INPUT)

    const altaCall = rpcSpy.mock.calls.find((c) => c[0] === 'crear_o_anadir_a_familia')
    expect(altaCall).toBeUndefined()
    // La única RPC usada es la del curso activo (server-derivado).
    expect(rpcSpy.mock.calls.map((c) => c[0])).toEqual(['curso_activo_de_centro'])
  })

  it('cola vacía → el prospecto abre la lista en la posición 1', async () => {
    ultimaPosicion = null

    await anadirHijoAFamilia(VALID_INPUT)

    expect(insertSpy.mock.calls[0]![1]).toMatchObject({ posicion: 1 })
  })

  it('familia de OTRO centro → falla sin escribir nada', async () => {
    familiaRow = { id: FAMILIA, centro_id: 'otro-centro' }

    const r = await anadirHijoAFamilia(VALID_INPUT)

    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('admin.admisiones.anadirHijo.errors.familia_no_encontrada')
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('familia sin ningún adulto CON CUENTA → no elegible (no hay usuario_id que guardar)', async () => {
    tutoresRows = [
      { usuario_id: null, nombre_completo: 'Sin cuenta', email: null, rol_familia: 'titular' },
    ]

    const r = await anadirHijoAFamilia(VALID_INPUT)

    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('admin.admisiones.anadirHijo.errors.familia_no_elegible')
    expect(insertSpy).not.toHaveBeenCalled()
  })
})
