// @vitest-environment node
import { createHash } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { generarMandatoPdf } from '@/features/alta/lib/mandato-pdf'
import { textoCanonicoMandatoV3 } from '@/features/alta/lib/mandato-sepa'

import { POST } from '../route'

/**
 * El mandato del alta, desde el 2026-11-22 (cierre del mandato, `docs/specs/mandato-sepa-cierre.md`),
 * con una base de mentira que contesta lo que contesta la de verdad:
 *  - el PDF lo compone el SERVIDOR: un fichero que mande el móvil no se sube;
 *  - sus bytes entran en el sello v3, y el fichero se llama por el sello, sin `upsert`;
 *  - el PDF se puede rehacer desde lo que recibe la base: mismo sha256;
 *  - si el registro no entra, el servidor borra el fichero que nadie nombra;
 *  - Dirección, presencial: sin PDF, v2;
 *  - sin CID, y con el documento o la dirección mal, no se sube ni se registra nada.
 * Lo que la base hace con todo eso (recalcular el sello, mirar la ruta y el fichero) lo prueba
 * `mandato-prueba-sellada.rls.test.ts` contra la base de verdad.
 */

const NINO = 'aaaaaaaa-0000-4000-8000-000000000001'
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
    rpcError: null as { message: string; hint?: string } | null,
    validada: false,
    presencial: false,
    subidas: [] as { path: string; upsert: boolean; bytes: Uint8Array }[],
    borrados: [] as string[][],
  },
}))

vi.mock('@/features/cambios-pendientes/lib/gate', () => ({
  familiaAltaValidada: async () => bd.validada,
}))
vi.mock('@/shared/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))
vi.mock('@/features/alta/lib/authz-tutor', () => ({
  esAdminDeCentroDeNino: async () => bd.presencial,
}))
vi.mock('@/features/centros/contexto/roles-del-usuario', () => ({
  esSuperusuario: async () => false,
}))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          bd.borrados.push(paths)
          return { error: null }
        },
      }),
    },
  }),
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
      return { data: bd.rpcError ? null : 'id-mandato', error: bd.rpcError }
    },
  }),
}))

function peticion(campos: Record<string, string> = {}, conFichero = false) {
  const form = new FormData()
  if (conFichero)
    form.append('file', new File(['%PDF del movil'], 'mandato.pdf', { type: 'application/pdf' }))
  const base: Record<string, string> = {
    iban: IBAN,
    titular: 'Tutor Demo',
    titular_documento: 'X1234567L',
    titular_direccion: 'Calle Demo 1, Valencia',
    nombre_tecleado: 'Tutor Demo',
    firma_imagen: PNG,
    ...campos,
  }
  for (const [k, v] of Object.entries(base)) form.append(k, v)
  return new Request('http://x/es/alta/n/mandato-sepa', { method: 'POST', body: form })
}

async function enviar(campos?: Record<string, string>, conFichero = false) {
  const res = await POST(peticion(campos, conFichero), {
    params: Promise.resolve({ locale: 'va', ninoId: NINO }),
  })
  return {
    status: res.status,
    json: (await res.json()) as { success: boolean; error?: string; pendiente?: boolean },
  }
}

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')

beforeEach(() => {
  bd.centro = {
    nombre: 'Centro Demo',
    identificador_acreedor: 'ES81ZZZB00000000',
    direccion: 'Avinguda Demo 2',
  }
  bd.llamadas = []
  bd.rpcArgs = null
  bd.rpcError = null
  bd.validada = false
  bd.presencial = false
  bd.subidas = []
  bd.borrados = []
})

describe('POST /alta/[ninoId]/mandato-sepa (2026-11-22: el PDF del servidor, sellado)', () => {
  it('premisa: con todo bien se sube un fichero y se registra', async () => {
    const r = await enviar()
    expect(r.json.success).toBe(true)
    expect(bd.llamadas).toEqual(['sube', 'registrar_mandato_sepa'])
    expect(bd.subidas).toHaveLength(1)
  })

  it('el sello v3 lleva el sha256 de los bytes subidos, y el fichero se llama por el sello, sin upsert', async () => {
    await enviar()
    const a = bd.rpcArgs!
    const { path, upsert, bytes } = bd.subidas[0]
    expect(upsert).toBe(false)
    expect(a.p_documento_sha256).toBe(sha256(bytes))
    expect(a).toMatchObject({
      p_metodo: 'digital',
      p_documento_idioma: 'va',
      p_plantilla_pdf_version: 1,
      p_acreedor_direccion: 'Avinguda Demo 2',
      p_acreedor_cid: 'ES81ZZZB00000000',
    })
    const sello = sha256(
      textoCanonicoMandatoV3({
        identificadorMandato: a.p_identificador_mandato as string,
        iban: IBAN,
        titular: 'Tutor Demo',
        titularDocumento: 'X1234567L',
        titularDireccion: 'Calle Demo 1, Valencia',
        acreedorNombre: 'Centro Demo',
        acreedorCid: 'ES81ZZZB00000000',
        acreedorDireccion: 'Avinguda Demo 2',
        fechaFirmaIso: a.p_fecha_firma as string,
        documentoSha256: sha256(bytes),
        idioma: 'va',
        plantillaPdfVersion: 1,
      })
    )
    expect(a.p_texto_hash).toBe(sello)
    expect(path).toBe(`${CENTRO}/familia/${FAMILIA}/mandato-${sello}.pdf`)
    expect(a.p_documento_path).toBe(path)
  })

  it('el PDF se rehace desde lo que recibe la base, otro día: el mismo sha256', async () => {
    await enviar()
    const a = bd.rpcArgs!
    // Otro día: si el PDF llevara la hora en que se compone (jsPDF la pone por defecto), el rehecho
    // daría otro sha256. Sin mover el reloj, rehacerlo en el mismo segundo saldría verde por azar.
    vi.useFakeTimers({ now: Date.now() + 24 * 3600 * 1000 })
    const rehecho = generarMandatoPdf({
      identificadorMandato: a.p_identificador_mandato as string,
      iban: a.p_iban as string,
      titular: a.p_titular as string,
      titularDocumento: a.p_titular_documento as string,
      titularDireccion: a.p_titular_direccion as string,
      acreedorNombre: a.p_acreedor_nombre as string,
      acreedorDireccion: a.p_acreedor_direccion as string,
      acreedorCid: a.p_acreedor_cid as string,
      firmaDataUrl: a.p_firma_imagen as string,
      fechaFirmaIso: a.p_fecha_firma as string,
      idioma: 'va',
      plantillaVersion: 1,
    })
    vi.useRealTimers()
    expect(sha256(rehecho)).toBe(a.p_documento_sha256)
  })

  it('un fichero que manda el móvil no se sube: el PDF es el del servidor', async () => {
    await enviar({}, true)
    const texto = Buffer.from(bd.subidas[0].bytes).toString('latin1')
    expect(texto.startsWith('%PDF-')).toBe(true)
    expect(texto).not.toContain('PDF del movil')
  })

  it('si el registro no entra, el servidor borra el fichero que nadie nombra', async () => {
    bd.rpcError = { message: 'x', hint: 'sello_distinto' }
    const r = await enviar()
    expect(r.json.success).toBe(false)
    expect(bd.borrados).toEqual([[bd.subidas[0].path]])
  })

  it('Dirección, presencial: sin PDF y v2 (la prueba es el papel)', async () => {
    bd.presencial = true
    const r = await enviar({ firma_imagen: '' })
    expect(r.json.success).toBe(true)
    expect(bd.llamadas).toEqual(['registrar_mandato_sepa'])
    expect(bd.rpcArgs).toMatchObject({ p_metodo: 'presencial', p_documento_path: null })
    expect(bd.rpcArgs!.p_documento_sha256).toBeUndefined()
  })

  it('sin CID del centro: 409 centro_sin_cid, sin subir ni registrar', async () => {
    for (const cid of [null, '', '   ']) {
      bd.centro = { nombre: 'Centro Demo', identificador_acreedor: cid, direccion: 'X' }
      bd.llamadas = []
      expect.soft(await enviar(), JSON.stringify(cid)).toEqual({
        status: 409,
        json: { success: false, error: 'alta.sepa.errors.centro_sin_cid' },
      })
      expect.soft(bd.llamadas, JSON.stringify(cid)).toEqual([])
    }
  })

  it('el documento, la dirección y el trazo se validan antes de subir nada', async () => {
    for (const [campos, error] of [
      [{ titular_documento: '12345678A' }, 'alta.sepa.errors.documento'],
      [{ titular_direccion: 'C/1' }, 'alta.sepa.errors.direccion'],
      [{ firma_imagen: 'data:image/jpeg;base64,AAAA' }, 'alta.sepa.errors.firma'],
    ] as const) {
      bd.llamadas = []
      expect
        .soft((await enviar(campos)).json, JSON.stringify(campos))
        .toEqual({ success: false, error })
      expect.soft(bd.llamadas, JSON.stringify(campos)).toEqual([])
    }
  })

  it('familia validada: el mandato se propone, con el mismo fichero sellado', async () => {
    bd.validada = true
    const r = await enviar()
    expect(r.json).toMatchObject({ success: true, pendiente: true })
    expect(bd.llamadas).toEqual(['sube', 'proponer_mandato_sepa'])
    expect(bd.subidas[0].upsert).toBe(false)
    expect(bd.subidas[0].path).toBe(
      `${CENTRO}/familia/${FAMILIA}/mandato-${bd.rpcArgs!.p_texto_hash as string}.pdf`
    )
  })

  it('lo que contesta la base se dice con su clave', async () => {
    for (const [hint, status, error] of [
      ['centro_sin_cid', 409, 'alta.sepa.errors.centro_sin_cid'],
      ['acreedor_distinto', 409, 'alta.sepa.errors.acreedor_cambio'],
      ['mandato_pendiente', 409, 'alta.sepa.errors.mandato_pendiente'],
      ['sello_distinto', 500, 'alta.sepa.errors.guardado'],
    ] as const) {
      bd.rpcError = { message: 'x', hint }
      expect.soft(await enviar(), hint).toEqual({ status, json: { success: false, error } })
    }
  })
  it('un PNG que pasa la cabecera y no decodifica: el mensaje de firma (400), sin subir ni registrar', async () => {
    // El trazo exacto que medimos el 2026-11-23: la cabecera de un PNG y nada más. La ruta solo mira
    // el prefijo y la longitud, así que este NO es el caso del JPEG: llega a componer el PDF.
    const TRUNCADO = 'data:image/png;base64,iVBORw0KGgo='
    expect(TRUNCADO.startsWith('data:image/png'), 'premisa: pasa la comprobación de la ruta').toBe(
      true
    )
    bd.llamadas = []
    expect(await enviar({ firma_imagen: TRUNCADO })).toEqual({
      status: 400,
      json: { success: false, error: 'alta.sepa.errors.firma' },
    })
    expect(bd.llamadas).toEqual([])
  })
})
