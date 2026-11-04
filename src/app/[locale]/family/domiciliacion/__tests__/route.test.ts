// @vitest-environment node
import { createHash } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { textoCanonicoMandatoV2 } from '@/features/alta/lib/mandato-sepa'

import { POST } from '../route'

/**
 * La domiciliación desde Recibos (0c-2), el segundo de los tres caminos que crean mandatos:
 *  - sin CID del centro: 409 `centro_sin_cid` antes de subir el PDF y de llamar a la RPC (la
 *    página no ofrece el botón; esto es por si llega igual);
 *  - con CID, la RPC recibe el v2 con el hash del texto v2;
 *  - el documento y la dirección del titular se validan antes de subir nada.
 */

const CENTRO = 'cccccccc-0000-4000-8000-000000000001'
const FAMILIA = 'ffffffff-0000-4000-8000-000000000001'
const USER = 'bbbbbbbb-0000-4000-8000-000000000001'
const IBAN = 'ES9121000418450200051332'

const { bd } = vi.hoisted(() => ({
  bd: {
    centro: null as { nombre: string; identificador_acreedor: string | null } | null,
    llamadas: [] as string[],
    rpcArgs: null as Record<string, unknown> | null,
  },
}))

vi.mock('@/shared/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))
vi.mock('@/features/centros/contexto/ambito-familiar', () => ({
  familiaDelUsuarioEn: async () => ({ centroId: CENTRO, familiaId: FAMILIA }),
}))
vi.mock('@/features/alta/queries/get-mandato-familia', () => ({
  familiaTieneMandatoActivo: async () => null,
}))
vi.mock('@/shared/lib/adjuntos/storage', () => ({
  BUCKET_MANDATO_SEPA: 'mandato-sepa',
  firmarRuta: async () => 'https://firmada',
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    from: () => {
      const b: Record<string, unknown> = {}
      const self = () => b as never
      b.select = () => self()
      b.eq = () => self()
      b.maybeSingle = async () => ({ data: bd.centro, error: null })
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
      return { data: 'id-mandato', error: null }
    },
  }),
}))

async function enviar(campos: Record<string, string> = {}) {
  const form = new FormData()
  form.append('file', new File(['%PDF'], 'mandato.pdf', { type: 'application/pdf' }))
  const base: Record<string, string> = {
    centro_id: CENTRO,
    iban: IBAN,
    titular: 'Tutor Demo',
    titular_documento: '12345678Z',
    titular_direccion: 'Calle Demo 1, Valencia',
    identificador_mandato: 'NIDO-A-B-2',
    nombre_tecleado: 'Tutor Demo',
    firma_imagen: 'data:image/png;base64,AAAA',
    ...campos,
  }
  for (const [k, v] of Object.entries(base)) form.append(k, v)
  const res = await POST(
    new Request('http://x/es/family/domiciliacion', { method: 'POST', body: form })
  )
  return { status: res.status, json: (await res.json()) as { success: boolean; error?: string } }
}

beforeEach(() => {
  bd.centro = { nombre: 'Centro Demo', identificador_acreedor: 'ES81ZZZB00000000' }
  bd.llamadas = []
  bd.rpcArgs = null
})

describe('POST /family/domiciliacion (0c-2)', () => {
  it('sin CID del centro: 409 centro_sin_cid, sin subir ni llamar a la RPC', async () => {
    bd.centro = { nombre: 'Centro Demo', identificador_acreedor: null }
    expect(await enviar()).toEqual({
      status: 409,
      json: { success: false, error: 'alta.sepa.errors.centro_sin_cid' },
    })
    expect(bd.llamadas).toEqual([])
  })

  it('con CID, la RPC recibe el v2 con el hash del texto v2', async () => {
    const r = await enviar()
    expect(r.json.success).toBe(true)
    expect(bd.llamadas).toEqual(['sube', 'registrar_mandato_sepa'])
    const a = bd.rpcArgs!
    expect(a).toMatchObject({
      p_titular_documento: '12345678Z',
      p_titular_direccion: 'Calle Demo 1, Valencia',
      p_acreedor_cid: 'ES81ZZZB00000000',
      p_acreedor_nombre: 'Centro Demo',
    })
    expect(a.p_texto_hash).toBe(
      createHash('sha256')
        .update(
          textoCanonicoMandatoV2({
            identificadorMandato: 'NIDO-A-B-2',
            iban: IBAN,
            titular: 'Tutor Demo',
            titularDocumento: '12345678Z',
            titularDireccion: 'Calle Demo 1, Valencia',
            acreedorNombre: 'Centro Demo',
            acreedorCid: 'ES81ZZZB00000000',
            fechaFirmaIso: a.p_fecha_firma as string,
          })
        )
        .digest('hex')
    )
  })

  it('el documento y la dirección se validan antes de subir nada', async () => {
    for (const [campos, error] of [
      [{ titular_documento: '12345678A' }, 'alta.sepa.errors.documento'],
      [{ titular_direccion: '' }, 'alta.sepa.errors.direccion'],
    ] as const) {
      bd.llamadas = []
      expect.soft((await enviar(campos)).json, JSON.stringify(campos)).toEqual({
        success: false,
        error,
      })
      expect.soft(bd.llamadas).toEqual([])
    }
  })
})
