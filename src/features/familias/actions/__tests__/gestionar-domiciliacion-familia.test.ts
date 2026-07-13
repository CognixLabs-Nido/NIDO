import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * F-2c-3 — `gestionarDomiciliacionFamilia` (Dirección, presencial). Fija:
 *  - familia SIN mandato → llama `registrar_mandato_sepa`.
 *  - familia CON mandato → llama `sustituir_mandato_sepa`.
 *  - en ambos: parámetros PRESENCIALES (metodo='presencial', documento_path NULL,
 *    firma_imagen '', nino_id NULL) e IBAN normalizado.
 *  - no-admin → forbidden (no llama RPC); familia de otro centro → no_encontrada.
 *
 * Mock: cliente Supabase server (builder), getCentroActualId, familiaTieneMandatoActivo.
 */

const CENTRO = '33333333-3333-4333-8333-333333333333'
const OTRO_CENTRO = '99999999-9999-4999-8999-999999999999'
const FAMILIA = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'
const IBAN_CON_ESPACIOS = 'ES76 2077 0024 0031 0257 5766'

let rolesResult: Array<{ rol: string; centro_id: string }>
let familiaRow: { id: string; centro_id: string } | null
let mandatoActivo: unknown
let rpcSpy: ReturnType<typeof vi.fn>

function makeServerFake() {
  function builder(table: string) {
    const result = () => {
      if (table === 'roles_usuario') return { data: rolesResult, error: null }
      if (table === 'familias') return { data: familiaRow, error: null }
      return { data: null, error: null }
    }
    const b: Record<string, unknown> = {}
    const self = () => b as never
    b.select = () => self()
    b.eq = () => self()
    b.is = () => self()
    b.maybeSingle = () => result()
    // roles_usuario se await directamente (sin maybeSingle) → thenable.
    b.then = (resolve: (v: unknown) => unknown) => resolve(result())
    return b
  }
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    from: (t: string) => builder(t),
    rpc: rpcSpy,
  }
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => makeServerFake() }))
vi.mock('@/features/centros/queries/get-centro-actual', () => ({
  getCentroActualId: async () => CENTRO,
}))
vi.mock('@/features/alta/queries/get-mandato-familia', () => ({
  familiaTieneMandatoActivo: async () => mandatoActivo,
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

import { gestionarDomiciliacionFamilia } from '../gestionar-domiciliacion-familia'

beforeEach(() => {
  rolesResult = [{ rol: 'admin', centro_id: CENTRO }]
  familiaRow = { id: FAMILIA, centro_id: CENTRO }
  mandatoActivo = null
  rpcSpy = vi.fn(async () => ({ data: null, error: null }))
})

const base = { familia_id: FAMILIA, iban: IBAN_CON_ESPACIOS, titular: 'Ana Pérez' }

describe('gestionarDomiciliacionFamilia', () => {
  it('familia SIN mandato → registrar_mandato_sepa, params presenciales, IBAN normalizado', async () => {
    mandatoActivo = null
    const r = await gestionarDomiciliacionFamilia(base)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.operacion).toBe('registrado')

    expect(rpcSpy).toHaveBeenCalledTimes(1)
    const [name, args] = rpcSpy.mock.calls[0]
    expect(name).toBe('registrar_mandato_sepa')
    expect(args.p_metodo).toBe('presencial')
    expect(args.p_documento_path).toBeNull()
    expect(args.p_firma_imagen).toBe('')
    expect(args.p_nino_id).toBeNull()
    expect(args.p_texto_hash).toBeNull()
    expect(args.p_iban).toBe('ES7620770024003102575766') // normalizado (sin espacios)
    expect(args.p_titular).toBe('Ana Pérez')
    expect(args.p_familia_id).toBe(FAMILIA)
  })

  it('familia CON mandato → sustituir_mandato_sepa (presencial)', async () => {
    mandatoActivo = { ultimos4: '5766', titular: 'Ana', identificador_mandato: 'X' }
    const r = await gestionarDomiciliacionFamilia(base)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.operacion).toBe('sustituido')

    const [name, args] = rpcSpy.mock.calls[0]
    expect(name).toBe('sustituir_mandato_sepa')
    expect(args.p_metodo).toBe('presencial')
    expect(args.p_documento_path).toBeNull()
    expect(args.p_firma_imagen).toBe('')
  })

  it('no-admin → forbidden, sin llamar RPC', async () => {
    rolesResult = [{ rol: 'profe', centro_id: CENTRO }]
    const r = await gestionarDomiciliacionFamilia(base)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('auth.invitation.errors.forbidden')
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('familia de OTRO centro → no_encontrada, sin llamar RPC', async () => {
    familiaRow = { id: FAMILIA, centro_id: OTRO_CENTRO }
    const r = await gestionarDomiciliacionFamilia(base)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('admin.familias.errors.no_encontrada')
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('IBAN inválido → error de validación, sin llamar RPC', async () => {
    const r = await gestionarDomiciliacionFamilia({ ...base, iban: 'ES00 1234' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('admin.familias.domiciliacion.validation.iban')
    expect(rpcSpy).not.toHaveBeenCalled()
  })
})
