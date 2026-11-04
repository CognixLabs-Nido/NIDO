import { createHash } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { textoCanonicoMandatoV2 } from '@/features/alta/lib/mandato-sepa'

/**
 * F-2c-3 — `gestionarDomiciliacionFamilia` (Dirección, presencial). Fija:
 *  - familia SIN mandato → llama `registrar_mandato_sepa`.
 *  - familia CON mandato → llama `sustituir_mandato_sepa`.
 *  - en ambos: parámetros PRESENCIALES (metodo='presencial', documento_path NULL,
 *    firma_imagen '', nino_id NULL) e IBAN normalizado.
 *  - no-admin → forbidden (no llama RPC); familia de otro centro → no_encontrada.
 *  - 0c-2: el hash v2 sobre lo que teclea la directora (CID del centro, documento y dirección del
 *    titular), y sin CID del centro no se llama a ninguna RPC.
 *
 * Mock: cliente Supabase server (builder) y familiaTieneMandatoActivo.
 */

const CENTRO = '33333333-3333-4333-8333-333333333333'
const OTRO_CENTRO = '99999999-9999-4999-8999-999999999999'
const FAMILIA = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'
const IBAN_CON_ESPACIOS = 'ES76 2077 0024 0031 0257 5766'

let rolesResult: Array<{ rol: string; centro_id: string }>
let familiaRow: { id: string; centro_id: string } | null
let centroRow: { nombre: string; identificador_acreedor: string | null } | null
let mandatoActivo: unknown
let rpcSpy: ReturnType<typeof vi.fn>
let esSuper: boolean

function makeServerFake() {
  function builder(table: string) {
    const result = () => {
      if (table === 'roles_usuario') return { data: rolesResult, error: null }
      if (table === 'familias') return { data: familiaRow, error: null }
      if (table === 'centros') return { data: centroRow, error: null }
      return { data: null, error: null }
    }
    const b: Record<string, unknown> = {}
    const self = () => b as never
    b.select = () => self()
    b.eq = () => self()
    b.is = () => self()
    b.maybeSingle = () => result()
    // roles_usuario se await directamente (sin maybeSingle) → thenable.
    // `centros` se await directamente al mirar el superusuario (una lista) y con maybeSingle al
    // leer el acreedor (una fila).
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve(table === 'centros' ? { data: [], error: null } : result())
    return b
  }
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    from: (t: string) => builder(t),
    // is_superadmin se contesta aquí (esSuperusuario): el espía solo ve las RPC de la acción.
    rpc: (fn: string, args: unknown) =>
      fn === 'is_superadmin'
        ? Promise.resolve({ data: esSuper, error: null })
        : (rpcSpy as (f: string, a: unknown) => Promise<unknown>)(fn, args),
  }
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => makeServerFake() }))
vi.mock('@/features/alta/queries/get-mandato-familia', () => ({
  familiaTieneMandatoActivo: async () => mandatoActivo,
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

import { gestionarDomiciliacionFamilia } from '../gestionar-domiciliacion-familia'

beforeEach(() => {
  rolesResult = [{ rol: 'admin', centro_id: CENTRO }]
  familiaRow = { id: FAMILIA, centro_id: CENTRO }
  centroRow = { nombre: 'Centro Demo', identificador_acreedor: 'ES81ZZZB00000000' }
  mandatoActivo = null
  rpcSpy = vi.fn(async () => ({ data: null, error: null }))
  esSuper = false
})

const base = {
  familia_id: FAMILIA,
  iban: IBAN_CON_ESPACIOS,
  titular: 'Ana Pérez',
  titular_documento: '12345678Z',
  titular_direccion: 'Calle Demo 1, 46001 Valencia',
}

describe('gestionarDomiciliacionFamilia', () => {
  it('superusuario (ADR-0061): el mandato presencial es de la directora; no llama a ninguna RPC', async () => {
    esSuper = true
    const r = await gestionarDomiciliacionFamilia(base)
    expect(r).toEqual({ success: false, error: 'admin.familias.errors.presencial_solo_direccion' })
    expect(rpcSpy).not.toHaveBeenCalled()
  })

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
    expect(args.p_iban).toBe('ES7620770024003102575766') // normalizado (sin espacios)
    expect(args.p_titular).toBe('Ana Pérez')
    expect(args.p_familia_id).toBe(FAMILIA)
    // 0c-2: los datos del v2, con el CID y el nombre del centro tal como los lee la acción.
    expect(args).toMatchObject({
      p_titular_documento: '12345678Z',
      p_titular_direccion: 'Calle Demo 1, 46001 Valencia',
      p_acreedor_cid: 'ES81ZZZB00000000',
      p_acreedor_nombre: 'Centro Demo',
    })
    // Hasta el 0c-2 el presencial iba sin hash (p_texto_hash NULL). Ahora, el del texto v2 sobre
    // lo que se mandó: el identificador y la fecha son los de la propia llamada.
    expect(args.p_texto_hash).toBe(
      createHash('sha256')
        .update(
          textoCanonicoMandatoV2({
            identificadorMandato: args.p_identificador_mandato,
            iban: 'ES7620770024003102575766',
            titular: 'Ana Pérez',
            titularDocumento: '12345678Z',
            titularDireccion: 'Calle Demo 1, 46001 Valencia',
            acreedorNombre: 'Centro Demo',
            acreedorCid: 'ES81ZZZB00000000',
            fechaFirmaIso: args.p_fecha_firma,
          })
        )
        .digest('hex')
    )
  })

  it('sin CID del centro no se firma: centro_sin_cid, sin llamar RPC', async () => {
    centroRow = { nombre: 'Centro Demo', identificador_acreedor: null }
    const r = await gestionarDomiciliacionFamilia(base)
    expect(r).toEqual({
      success: false,
      error: 'admin.familias.domiciliacion.errors.centro_sin_cid',
    })
    expect(rpcSpy).not.toHaveBeenCalled()
    // Control: un CID en blanco cuenta como sin CID.
    centroRow = { nombre: 'Centro Demo', identificador_acreedor: '   ' }
    const r2 = await gestionarDomiciliacionFamilia(base)
    expect(r2.success).toBe(false)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('documento extranjero: se acepta tal cual; un DNI con la letra mal, no', async () => {
    const r = await gestionarDomiciliacionFamilia({ ...base, titular_documento: 'FR 12AB34567' })
    expect(r.success).toBe(true)
    expect(rpcSpy.mock.calls[0]?.[1]).toMatchObject({ p_titular_documento: 'FR 12AB34567' })

    rpcSpy.mockClear()
    const malo = await gestionarDomiciliacionFamilia({ ...base, titular_documento: '12345678A' })
    expect(malo).toEqual({
      success: false,
      error: 'admin.familias.domiciliacion.validation.documento',
    })
    const sinDir = await gestionarDomiciliacionFamilia({ ...base, titular_direccion: '' })
    expect(sinDir).toEqual({
      success: false,
      error: 'admin.familias.domiciliacion.validation.direccion',
    })
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('lo que contesta la base del acreedor se dice con su clave', async () => {
    for (const [hint, clave] of [
      ['centro_sin_cid', 'centro_sin_cid'],
      ['cid_distinto', 'acreedor_cambio'],
      ['acreedor_distinto', 'acreedor_cambio'],
    ] as const) {
      rpcSpy = vi.fn(async () => ({ data: null, error: { message: 'x', hint } }))
      const r = await gestionarDomiciliacionFamilia(base)
      expect.soft(r, hint).toEqual({
        success: false,
        error: `admin.familias.domiciliacion.errors.${clave}`,
      })
    }
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

  it('familia que la RLS no deja ver (otro centro) → no_encontrada, sin llamar RPC', async () => {
    familiaRow = null
    const r = await gestionarDomiciliacionFamilia(base)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('admin.familias.errors.no_encontrada')
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('el centro es el DE LA FAMILIA: ser admin en otro centro no basta → forbidden', async () => {
    familiaRow = { id: FAMILIA, centro_id: OTRO_CENTRO }
    // Premisa: admin en CENTRO, sin rol admin en el centro de la familia.
    expect(rolesResult).toEqual([{ rol: 'admin', centro_id: CENTRO }])
    const r = await gestionarDomiciliacionFamilia(base)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('auth.invitation.errors.forbidden')
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('familia de otro centro donde TAMBIÉN es admin → registra (centro de la familia)', async () => {
    familiaRow = { id: FAMILIA, centro_id: OTRO_CENTRO }
    rolesResult = [
      { rol: 'admin', centro_id: CENTRO },
      { rol: 'admin', centro_id: OTRO_CENTRO },
    ]
    const r = await gestionarDomiciliacionFamilia(base)
    expect(r.success).toBe(true)
    expect(rpcSpy).toHaveBeenCalledTimes(1)
  })

  it('IBAN inválido → error de validación, sin llamar RPC', async () => {
    const r = await gestionarDomiciliacionFamilia({ ...base, iban: 'ES00 1234' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('admin.familias.domiciliacion.validation.iban')
    expect(rpcSpy).not.toHaveBeenCalled()
  })
})
