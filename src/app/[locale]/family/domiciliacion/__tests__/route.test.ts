// @vitest-environment node
import { createHash } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { POST } from '../route'

/**
 * La domiciliación desde Recibos, desde el 2026-11-22 (cierre del mandato): el PDF lo compone el
 * servidor y se sube con el nombre del sello, sin `upsert`; la vía depende de la familia (validada,
 * con mandato activo o sin él). El detalle del sello lo prueba el test de la ruta del alta, que
 * comparte `firmarMandatoDigital`; aquí, lo que es de esta ruta.
 */

const CENTRO = 'cccccccc-0000-4000-8000-000000000001'
const FAMILIA = 'ffffffff-0000-4000-8000-000000000001'
const USER = 'bbbbbbbb-0000-4000-8000-000000000001'
const IBAN = 'ES9121000418450200051332'
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const { bd } = vi.hoisted(() => ({
  bd: {
    centro: null as {
      nombre: string
      identificador_acreedor: string | null
      direccion: string | null
    } | null,
    llamadas: [] as string[],
    rpcArgs: null as Record<string, unknown> | null,
    validada: false,
    activo: null as { id: string } | null,
    activoCaido: false,
    subidas: [] as { path: string; upsert: boolean; bytes: Uint8Array }[],
  },
}))

vi.mock('@/features/cambios-pendientes/lib/gate', () => ({
  familiaAltaValidada: async () => bd.validada,
}))
vi.mock('@/shared/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))
vi.mock('@/features/centros/contexto/ambito-familiar', () => ({
  familiaDelUsuarioEn: async () => ({ centroId: CENTRO, familiaId: FAMILIA }),
}))
vi.mock('@/features/alta/queries/get-mandato-familia', async () => {
  const { LecturaFallida } = await import('@/shared/lib/lectura-fallida')
  return {
    familiaTieneMandatoActivo: async () => {
      if (bd.activoCaido)
        throw new LecturaFallida('familiaTieneMandatoActivo', { code: 'XX000', message: 'x' })
      return bd.activo
    },
  }
})
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  }),
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
        upload: async (path: string, bytes: Uint8Array, o: { upsert: boolean }) => {
          bd.subidas.push({ path, upsert: o.upsert, bytes })
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
  const base: Record<string, string> = {
    centro_id: CENTRO,
    iban: IBAN,
    titular: 'Tutor Demo',
    titular_documento: 'X1234567L',
    titular_direccion: 'Calle Demo 1, Valencia',
    nombre_tecleado: 'Tutor Demo',
    firma_imagen: PNG,
    ...campos,
  }
  for (const [k, v] of Object.entries(base)) form.append(k, v)
  const res = await POST(
    new Request('http://x/es/family/domiciliacion', { method: 'POST', body: form }),
    {
      params: Promise.resolve({ locale: 'es' }),
    }
  )
  return { status: res.status, json: (await res.json()) as { success: boolean; error?: string } }
}

beforeEach(() => {
  bd.centro = {
    nombre: 'Centro Demo',
    identificador_acreedor: 'ES81ZZZB00000000',
    direccion: 'Calle 2',
  }
  bd.llamadas = []
  bd.rpcArgs = null
  bd.validada = false
  bd.activo = null
  bd.activoCaido = false
  bd.subidas = []
})

describe('POST /family/domiciliacion (2026-11-22: el PDF del servidor, sellado)', () => {
  it('sin mandato activo: registra un v3 con su fichero sellado, sin upsert', async () => {
    const r = await enviar()
    expect(r.json.success).toBe(true)
    expect(bd.llamadas).toEqual(['sube', 'registrar_mandato_sepa'])
    const { path, upsert, bytes } = bd.subidas[0]
    expect(upsert).toBe(false)
    expect(bd.rpcArgs!.p_documento_sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(path).toBe(
      `${CENTRO}/familia/${FAMILIA}/mandato-${bd.rpcArgs!.p_texto_hash as string}.pdf`
    )
  })

  it('con mandato activo, sustituye; con la familia validada, propone', async () => {
    bd.activo = { id: 'm1' }
    await enviar()
    expect(bd.llamadas).toEqual(['sube', 'sustituir_mandato_sepa'])
    bd.llamadas = []
    bd.validada = true
    await enviar()
    expect(bd.llamadas).toEqual(['sube', 'proponer_mandato_sepa'])
  })

  it('sin CID del centro: 409 centro_sin_cid, sin subir ni registrar', async () => {
    bd.centro = { nombre: 'Centro Demo', identificador_acreedor: null, direccion: null }
    expect(await enviar()).toEqual({
      status: 409,
      json: { success: false, error: 'alta.sepa.errors.centro_sin_cid' },
    })
    expect(bd.llamadas).toEqual([])
  })

  it('el documento y la dirección se validan antes de subir nada', async () => {
    for (const [campos, error] of [
      [{ titular_documento: '12345678A' }, 'alta.sepa.errors.documento'],
      [{ titular_direccion: 'C/1' }, 'alta.sepa.errors.direccion'],
    ] as const) {
      bd.llamadas = []
      expect
        .soft((await enviar(campos)).json, JSON.stringify(campos))
        .toEqual({ success: false, error })
      expect.soft(bd.llamadas).toEqual([])
    }
  })
})

// Censo C (B1, 2026-11-26): sin leer si ya hay mandato activo, antes era «no hay» y se registraba otro encima.
// Ahora 500 lectura_fallida, sin subir ni registrar nada. Premisa: los dos casos de arriba.
describe('POST /family/domiciliacion — el mandato activo sin leer', () => {
  it('500 lectura_fallida, sin subir ni registrar', async () => {
    bd.activoCaido = true
    expect(await enviar()).toEqual({
      status: 500,
      json: { success: false, error: 'common.lectura_fallida' },
    })
    expect(bd.llamadas).toEqual([])
  })
})
