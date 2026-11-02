import { describe, expect, it } from 'vitest'

import {
  marcaDeAhora,
  obtenerFicheroRemesa,
  rutaFicheroRemesa,
  sha256Hex,
  type DepsFichero,
  type FicheroGenerado,
} from '../fichero-remesa'

/**
 * R-1 (`20261220120000`): el fichero de cada versión se guarda la primera vez que sale y desde ahí
 * se sirve el guardado. Unas dependencias de mentira con un bucket y un registro en memoria, que
 * apuntan cada paso.
 */

const REMESA = { id: 'r1', centroId: 'c1' }
const AHORA = new Date('2026-11-02T10:15:42.789Z')

function montar(opts: {
  guardado?: { ruta: string; xml: string; sha256?: string }
  generar?: (marca: string | null) => FicheroGenerado | { status: number; body: { error: string } }
  registrar?: { ok: true } | { ok: false; hint: string | null }
  subidaExiste?: boolean
  // Lo que otra descarga guardó entre medias (se ve en la segunda lectura de la vigente).
  otraGuardo?: { ruta: string; xml: string }
}) {
  const bucket = new Map<string, string>()
  const pasos: string[] = []
  let vigente: { ruta: string; sha256: string } | null = null
  if (opts.guardado) {
    bucket.set(opts.guardado.ruta, opts.guardado.xml)
    vigente = {
      ruta: opts.guardado.ruta,
      sha256: opts.guardado.sha256 ?? sha256Hex(opts.guardado.xml),
    }
  }
  const generadas: Array<string | null> = []
  const deps: DepsFichero = {
    vigente: async () => {
      pasos.push('vigente')
      return vigente
    },
    generar: async (marca) => {
      pasos.push(`genera ${marca ?? 'sin marca'}`)
      generadas.push(marca)
      if (opts.generar) return opts.generar(marca)
      return {
        xml: `<xml marca="${marca}"/>`,
        msgId: `NIDO-r1-${marca}`,
        adeudos: [{ recibo_id: 'rc', end_to_end_id: 'RC', importe_centimos: 100, mndt_id: 'M' }],
      }
    },
    subir: async (ruta, xml) => {
      pasos.push(`sube ${ruta}`)
      if (opts.subidaExiste) return 'existe'
      bucket.set(ruta, xml)
      return 'ok'
    },
    bajar: async (ruta) => {
      pasos.push(`baja ${ruta}`)
      return bucket.get(ruta) ?? null
    },
    borrar: async (ruta) => {
      pasos.push(`borra ${ruta}`)
      bucket.delete(ruta)
    },
    registrar: async (v) => {
      pasos.push(`registra ${v.marca}`)
      const r = opts.registrar ?? { ok: true }
      if (r.ok) vigente = { ruta: v.ruta, sha256: v.sha256 }
      else if (opts.otraGuardo) {
        bucket.set(opts.otraGuardo.ruta, opts.otraGuardo.xml)
        vigente = { ruta: opts.otraGuardo.ruta, sha256: sha256Hex(opts.otraGuardo.xml) }
      }
      return r
    },
    ahora: () => AHORA,
  }
  return { deps, bucket, pasos, generadas }
}

describe('el fichero de cada versión de una remesa (R-1)', () => {
  it('la marca de una versión nueva es la hora del servidor sin milisegundos', () => {
    expect(marcaDeAhora(AHORA)).toBe('2026-11-02T10:15:42.000Z')
  })

  it('la ruta es la que exige la base: centro, remesa y MsgId', () => {
    expect(rutaFicheroRemesa('c1', 'r1', 'NIDO-x')).toBe('c1/r1/NIDO-x.xml')
  })

  it('la primera descarga comprueba, genera con la marca nueva, sube y registra, y sirve lo subido', async () => {
    const { deps, bucket, pasos } = montar({})
    const r = await obtenerFicheroRemesa(deps, { ...REMESA, marca: null })
    const marca = '2026-11-02T10:15:42.000Z'
    expect(pasos).toEqual([
      'genera sin marca',
      `genera ${marca}`,
      `sube c1/r1/NIDO-r1-${marca}.xml`,
      `registra ${marca}`,
    ])
    expect(r).toEqual({ xml: `<xml marca="${marca}"/>` })
    expect(bucket.get(`c1/r1/NIDO-r1-${marca}.xml`)).toBe(`<xml marca="${marca}"/>`)
  })

  it('con la versión guardada se sirve la guardada, sin generar nada', async () => {
    const { deps, pasos, generadas } = montar({ guardado: { ruta: 'c1/r1/v.xml', xml: '<a/>' } })
    const r = await obtenerFicheroRemesa(deps, { ...REMESA, marca: '2026-10-01T00:00:00Z' })
    expect(r).toEqual({ xml: '<a/>' })
    expect(generadas).toEqual([])
    expect(pasos).toEqual(['vigente', 'baja c1/r1/v.xml'])
  })

  it('lo guardado que no es lo registrado no se sirve (500)', async () => {
    const { deps } = montar({
      guardado: { ruta: 'c1/r1/v.xml', xml: '<a/>', sha256: sha256Hex('<b/>') },
    })
    const r = await obtenerFicheroRemesa(deps, { ...REMESA, marca: '2026-10-01T00:00:00Z' })
    expect(r).toEqual({ status: 500, body: { error: 'fichero_alterado' } })
  })

  it('una marca sin versión guardada (de antes de R-1) guarda la de esa marca, sin cambiarla', async () => {
    const { deps, pasos } = montar({})
    const marca = '2026-10-01T09:00:00.123+00:00'
    const r = await obtenerFicheroRemesa(deps, { ...REMESA, marca })
    expect(pasos).toEqual([
      'vigente',
      `genera ${marca}`,
      `sube c1/r1/NIDO-r1-${marca}.xml`,
      `registra ${marca}`,
    ])
    expect(r).toEqual({ xml: `<xml marca="${marca}"/>` })
  })

  it('si el fichero no sale (422), no sube ni registra nada: la remesa no se cierra', async () => {
    const { deps, pasos } = montar({
      generar: () => ({ status: 422, body: { error: 'remesa_vacia' } }),
    })
    const r = await obtenerFicheroRemesa(deps, { ...REMESA, marca: null })
    expect(r).toEqual({ status: 422, body: { error: 'remesa_vacia' } })
    expect(pasos).toEqual(['genera sin marca'])
  })

  it('si el registro no entra, lo subido se borra y no se sirve', async () => {
    const { deps, bucket, pasos } = montar({ registrar: { ok: false, hint: null } })
    const r = await obtenerFicheroRemesa(deps, { ...REMESA, marca: null })
    expect(r).toEqual({ status: 500, body: { error: 'xml_failed' } })
    expect(pasos.at(-1)).toMatch(/^borra c1\/r1\//)
    expect(bucket.size).toBe(0)
  })

  it('si los recibos cambiaron entre la lectura y la marca, 409 y nada guardado', async () => {
    const { deps, bucket } = montar({ registrar: { ok: false, hint: 'recibos_cambiaron' } })
    const r = await obtenerFicheroRemesa(deps, { ...REMESA, marca: null })
    expect(r).toEqual({ status: 409, body: { error: 'remesa_cambio' } })
    expect(bucket.size).toBe(0)
  })

  it('si otra descarga fijó la versión antes, se borra lo propio y se sirve la suya', async () => {
    const { deps, bucket } = montar({
      registrar: { ok: false, hint: 'marca_distinta' },
      otraGuardo: { ruta: 'c1/r1/de-la-otra.xml', xml: '<otra/>' },
    })
    const r = await obtenerFicheroRemesa(deps, { ...REMESA, marca: null })
    expect(r).toEqual({ xml: '<otra/>' })
    expect([...bucket.keys()]).toEqual(['c1/r1/de-la-otra.xml'])
  })

  it('si la ruta ya existe (otra descarga a medias), 409 y no se toca lo que hay', async () => {
    const { deps, pasos } = montar({ subidaExiste: true })
    const r = await obtenerFicheroRemesa(deps, { ...REMESA, marca: null })
    expect(r).toEqual({ status: 409, body: { error: 'descarga_en_curso' } })
    expect(pasos.some((p) => p.startsWith('borra') || p.startsWith('registra'))).toBe(false)
  })

  it('la huella es la de los bytes UTF-8 del fichero', () => {
    // Calculada fuera (Python, `'ñ'.encode('utf-8')`): dos bytes, no uno en latin-1.
    expect(sha256Hex('ñ')).toBe('024bb90888ca89a15a19e9bdd8c712bfb070465fce1ef25e43c170ea44fc5e5f')
    expect(sha256Hex('ñ')).not.toBe(sha256Hex('n'))
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})
