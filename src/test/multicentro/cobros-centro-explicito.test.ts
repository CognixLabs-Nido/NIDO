// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Multicentro · Fase 1 · PR4 — las acciones de cobros ya no leen el centro de la cookie. Un usuario
 * con roles en DOS centros (A < B por id, así que «el primero» sería A):
 *  - (c) acciones de todo el centro (asignaciones, recibos del mes): el centro EXPLÍCITO de la
 *    página, con admin en él;
 *  - (a) y (b) acciones sobre un registro (recibo, familia, concepto, niño): el centro DEL REGISTRO,
 *    con admin en él. Ser admin en otro centro no basta.
 * Antes de este PR ninguna de estas acciones tenía test unitario.
 */

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const USUARIO = '11111111-1111-4111-8111-111111111111'
const FAMILIA = '22222222-2222-4222-8222-222222222222'
const RECIBO = '33333333-3333-4333-8333-333333333333'
const CONCEPTO = '44444444-4444-4444-8444-444444444444'
const NINO = '55555555-5555-4555-8555-555555555555'

const st = vi.hoisted(() => ({
  roles: [] as Array<{ centro_id: string; rol: string }>,
  filas: {} as Record<string, unknown>,
  rpc: vi.fn(),
  escrituras: vi.fn(),
}))

function builder(table: string) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) b[m] = () => b
  b.maybeSingle = async () => ({ data: st.filas[table] ?? null, error: null })
  b.single = async () => ({ data: st.filas[table] ?? { id: 'nuevo' }, error: null })
  for (const op of ['update', 'upsert', 'insert', 'delete']) {
    b[op] = (valores?: unknown) => {
      st.escrituras(table, op, valores)
      return b
    }
  }
  b.then = (resolve: (v: unknown) => unknown) =>
    resolve(
      table === 'roles_usuario' ? { data: st.roles, error: null } : { data: null, error: null }
    )
  return b
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USUARIO } } }) },
    from: (t: string) => builder(t),
    // is_superadmin se contesta aquí (esSuperusuario): el espía solo ve las RPC de la acción.
    rpc: (fn: string, args: unknown) =>
      fn === 'is_superadmin' ? Promise.resolve({ data: false, error: null }) : st.rpc(fn, args),
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/cursos/queries/get-cursos', () => ({
  getCursoActivo: async () => ({ id: 'curso-1' }),
}))

const { proponerAsignaciones } =
  await import('@/features/cuotas-config/actions/proponer-asignaciones')
const { generarRecibosMes } = await import('@/features/recibos/actions/generar-recibos-mes')
const { marcarCobradoManual } = await import('@/features/remesas/actions/marcar-cobrado-manual')
const { setMetodoPagoFamilia } = await import('@/features/recibos/actions/set-metodo-pago-familia')
const { guardarTarifaConceptoAnio } =
  await import('@/features/conceptos-cobro/actions/tarifa-concepto-anio')
const { toggleElegibilidad } = await import('@/features/beca-comedor/actions/elegibilidad')

const ADMIN_EN_A = [{ centro_id: A, rol: 'admin' }]
const ADMIN_EN_A_Y_B = [
  { centro_id: A, rol: 'admin' },
  { centro_id: B, rol: 'admin' },
]

beforeEach(() => {
  vi.clearAllMocks()
  st.filas = {}
  st.rpc.mockResolvedValue({ data: 1, error: null })
  // Premisa: «el primero por id» sería A; los casos piden B.
  expect([B, A].sort()[0]).toBe(A)
})

describe('(c) centro explícito de la página', () => {
  it('proponerAsignaciones: la RPC va al centro EXPLÍCITO (B), no al primero', async () => {
    st.roles = ADMIN_EN_A_Y_B
    const r = await proponerAsignaciones(B)
    expect(r.success).toBe(true)
    expect(st.rpc).toHaveBeenCalledWith('proponer_asignaciones', { p_centro_id: B })
  })

  it('proponerAsignaciones en un centro donde no es admin → no_autorizado, sin RPC', async () => {
    st.roles = ADMIN_EN_A
    const r = await proponerAsignaciones(B)
    expect(r).toEqual({ success: false, error: 'cuotas_config.errors.no_autorizado' })
    expect(st.rpc).not.toHaveBeenCalled()
  })

  it('generarRecibosMes: la RPC va al centro explícito', async () => {
    st.roles = ADMIN_EN_A_Y_B
    await generarRecibosMes({ anio: 2026, mes: 3 }, B)
    expect(st.rpc).toHaveBeenCalledWith('generar_recibos_mes', {
      p_centro_id: B,
      p_anio: 2026,
      p_mes: 3,
    })
  })

  it('un centro que no es uuid → no_autorizado, sin RPC', async () => {
    st.roles = ADMIN_EN_A_Y_B
    const r = await generarRecibosMes({ anio: 2026, mes: 3 }, 'no-es-un-uuid')
    expect(r.success).toBe(false)
    expect(st.rpc).not.toHaveBeenCalled()
  })
})

describe('(a)/(b) centro del registro', () => {
  it('marcarCobradoManual: recibo de B y admin solo en A → no_autorizado, sin escribir', async () => {
    st.roles = ADMIN_EN_A
    st.filas.recibos = { id: RECIBO, centro_id: B, estado: 'devuelto' }
    const r = await marcarCobradoManual({
      reciboId: RECIBO,
      forma: 'efectivo',
      fecha: '2024-01-10',
    })
    expect(r).toEqual({ success: false, error: 'remesas.errors.no_autorizado' })
    expect(st.escrituras).not.toHaveBeenCalled()
  })

  it('marcarCobradoManual: admin en el centro del recibo → escribe', async () => {
    st.roles = ADMIN_EN_A_Y_B
    st.filas.recibos = { id: RECIBO, centro_id: B, estado: 'devuelto' }
    const r = await marcarCobradoManual({
      reciboId: RECIBO,
      forma: 'efectivo',
      fecha: '2024-01-10',
    })
    expect(r.success).toBe(true)
    expect(st.escrituras).toHaveBeenCalledWith('recibos', 'update', expect.anything())
  })

  it('setMetodoPagoFamilia: el método se guarda con el centro DE LA FAMILIA', async () => {
    st.roles = ADMIN_EN_A_Y_B
    st.filas.familias = { centro_id: B }
    await setMetodoPagoFamilia(FAMILIA, 2026, 3, 'efectivo')
    expect(st.escrituras).toHaveBeenCalledWith(
      'metodo_pago_familia',
      'insert',
      expect.objectContaining({ centro_id: B, familia_id: FAMILIA })
    )
  })

  it('setMetodoPagoFamilia: familia de B y admin solo en A → no_autorizado', async () => {
    st.roles = ADMIN_EN_A
    st.filas.familias = { centro_id: B }
    const r = await setMetodoPagoFamilia(FAMILIA, 2026, 3, 'efectivo')
    expect(r).toEqual({ success: false, error: 'recibos_panel.errors.no_autorizado' })
    expect(st.escrituras).not.toHaveBeenCalled()
  })

  it('guardarTarifaConceptoAnio: la tarifa lleva el centro DEL CONCEPTO', async () => {
    st.roles = ADMIN_EN_A_Y_B
    st.filas.conceptos_cobro = { centro_id: B }
    await guardarTarifaConceptoAnio({
      concepto_id: CONCEPTO,
      anio_nacimiento: 2024,
      importe_euros: 10,
    })
    expect(st.escrituras).toHaveBeenCalledWith(
      'tarifa_concepto_anio',
      'upsert',
      expect.objectContaining({ centro_id: B, concepto_id: CONCEPTO })
    )
  })

  it('toggleElegibilidad: centro DEL NIÑO; con admin solo en otro centro → no_autorizado', async () => {
    st.filas.ninos = { centro_id: B }
    st.roles = ADMIN_EN_A
    const denegado = await toggleElegibilidad({ nino_id: NINO, activa: true })
    expect(denegado.success).toBe(false)
    expect(st.escrituras).not.toHaveBeenCalled()

    st.roles = ADMIN_EN_A_Y_B
    await toggleElegibilidad({ nino_id: NINO, activa: true })
    expect(st.escrituras).toHaveBeenCalledWith(
      'beca_comedor_elegibilidad',
      'upsert',
      expect.objectContaining({ centro_id: B, nino_id: NINO })
    )
  })
})
