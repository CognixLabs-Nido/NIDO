// @vitest-environment node
import { createHash } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { textoCanonicoMandatoV2 } from '@/features/alta/lib/mandato-sepa'

import { POST } from '../route'

/**
 * El mandato del alta (0c-2), con una base de mentira que contesta lo que contesta la de verdad:
 *  - sin CID del centro no se firma: 409 `centro_sin_cid` ANTES de subir el PDF y de llamar a la
 *    RPC (la base lo rechaza también, `20261229120000`; eso lo prueba `mandato-v2.rls.test.ts`);
 *  - con CID, la RPC recibe el v2: el documento y la dirección del titular, el CID y el nombre del
 *    centro que leyó la ruta, y el hash del texto v2;
 *  - el documento y la dirección se validan antes de subir nada;
 *  - lo que contesta la base del acreedor (`centro_sin_cid`, `cid_distinto`) se dice con su clave.
 */

const NINO = 'aaaaaaaa-0000-4000-8000-000000000001'
const CENTRO = 'cccccccc-0000-4000-8000-000000000001'
const FAMILIA = 'ffffffff-0000-4000-8000-000000000001'
const USER = 'bbbbbbbb-0000-4000-8000-000000000001'
const IBAN = 'ES9121000418450200051332'

const { bd } = vi.hoisted(() => ({
  bd: {
    centro: null as { nombre: string; identificador_acreedor: string | null } | null,
    llamadas: [] as string[],
    rpcArgs: null as Record<string, unknown> | null,
    rpcError: null as { message: string; hint?: string } | null,
  },
}))

vi.mock('@/shared/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))
vi.mock('@/features/alta/lib/authz-tutor', () => ({ esAdminDeCentroDeNino: async () => false }))
vi.mock('@/features/centros/contexto/roles-del-usuario', () => ({
  esSuperusuario: async () => false,
}))
vi.mock('@/shared/lib/adjuntos/storage', () => ({
  BUCKET_MANDATO_SEPA: 'mandato-sepa',
  firmarRuta: async () => 'https://firmada',
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    from: (tabla: string) => {
      const fila =
        tabla === 'ninos'
          ? { id: NINO, centro_id: CENTRO, familia_id: FAMILIA }
          : tabla === 'centros'
            ? bd.centro
            : null
      const b: Record<string, unknown> = {}
      const self = () => b as never
      b.select = () => self()
      b.eq = () => self()
      b.is = () => self()
      b.maybeSingle = async () => ({ data: fila, error: null })
      return b
    },
    storage: {
      from: () => ({
        upload: async () => {
          bd.llamadas.push('sube')
          return { error: null }
        },
      }),
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      bd.llamadas.push(fn)
      bd.rpcArgs = args
      return { data: 'id-mandato', error: bd.rpcError }
    },
  }),
}))

function peticion(campos: Record<string, string> = {}) {
  const form = new FormData()
  form.append('file', new File(['%PDF'], 'mandato.pdf', { type: 'application/pdf' }))
  const base: Record<string, string> = {
    iban: IBAN,
    titular: 'Tutor Demo',
    titular_documento: 'X1234567L',
    titular_direccion: 'Calle Demo 1, Valencia',
    identificador_mandato: 'NIDO-A-B-1',
    nombre_tecleado: 'Tutor Demo',
    firma_imagen: 'data:image/png;base64,AAAA',
    ...campos,
  }
  for (const [k, v] of Object.entries(base)) form.append(k, v)
  return new Request('http://x/es/alta/n/mandato-sepa', { method: 'POST', body: form })
}

async function enviar(campos?: Record<string, string>) {
  const res = await POST(peticion(campos), { params: Promise.resolve({ ninoId: NINO }) })
  return { status: res.status, json: (await res.json()) as { success: boolean; error?: string } }
}

beforeEach(() => {
  bd.centro = { nombre: 'Centro Demo', identificador_acreedor: 'ES81ZZZB00000000' }
  bd.llamadas = []
  bd.rpcArgs = null
  bd.rpcError = null
})

describe('POST /alta/[ninoId]/mandato-sepa (0c-2)', () => {
  it('sin CID del centro: 409 centro_sin_cid, sin subir el PDF ni llamar a la RPC', async () => {
    for (const cid of [null, '', '   ']) {
      bd.centro = { nombre: 'Centro Demo', identificador_acreedor: cid }
      bd.llamadas = []
      const r = await enviar()
      expect.soft(r, JSON.stringify(cid)).toEqual({
        status: 409,
        json: { success: false, error: 'alta.sepa.errors.centro_sin_cid' },
      })
      expect.soft(bd.llamadas, JSON.stringify(cid)).toEqual([])
    }
  })

  it('con CID, la RPC recibe el v2 con el hash del texto v2 de lo que leyó la ruta', async () => {
    const r = await enviar()
    expect(r.json.success).toBe(true)
    expect(bd.llamadas).toEqual(['sube', 'registrar_mandato_sepa'])
    const a = bd.rpcArgs!
    expect(a).toMatchObject({
      p_titular_documento: 'X1234567L',
      p_titular_direccion: 'Calle Demo 1, Valencia',
      p_acreedor_cid: 'ES81ZZZB00000000',
      p_acreedor_nombre: 'Centro Demo',
      p_metodo: 'digital',
    })
    expect(a.p_texto_hash).toBe(
      createHash('sha256')
        .update(
          textoCanonicoMandatoV2({
            identificadorMandato: 'NIDO-A-B-1',
            iban: IBAN,
            titular: 'Tutor Demo',
            titularDocumento: 'X1234567L',
            titularDireccion: 'Calle Demo 1, Valencia',
            acreedorNombre: 'Centro Demo',
            acreedorCid: 'ES81ZZZB00000000',
            fechaFirmaIso: a.p_fecha_firma as string,
          })
        )
        .digest('hex')
    )
  })

  it('el documento y la dirección se validan antes de subir nada; un documento extranjero vale', async () => {
    for (const [campos, error] of [
      [{ titular_documento: '12345678A' }, 'alta.sepa.errors.documento'],
      [{ titular_documento: '' }, 'alta.sepa.errors.documento'],
      [{ titular_direccion: 'C/1' }, 'alta.sepa.errors.direccion'],
    ] as const) {
      bd.llamadas = []
      const r = await enviar(campos)
      expect.soft(r.json, JSON.stringify(campos)).toEqual({ success: false, error })
      expect.soft(bd.llamadas, JSON.stringify(campos)).toEqual([])
    }
    bd.llamadas = []
    const extranjero = await enviar({ titular_documento: 'FR 12AB34567' })
    expect(extranjero.json.success).toBe(true)
    expect(bd.rpcArgs).toMatchObject({ p_titular_documento: 'FR 12AB34567' })
  })

  it('lo que contesta la base del acreedor se dice con su clave', async () => {
    for (const [hint, error] of [
      ['centro_sin_cid', 'alta.sepa.errors.centro_sin_cid'],
      ['cid_distinto', 'alta.sepa.errors.acreedor_cambio'],
      ['acreedor_distinto', 'alta.sepa.errors.acreedor_cambio'],
    ] as const) {
      bd.rpcError = { message: 'x', hint }
      const r = await enviar()
      expect.soft(r, hint).toEqual({ status: 409, json: { success: false, error } })
    }
  })
})
