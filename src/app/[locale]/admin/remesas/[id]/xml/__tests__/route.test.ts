import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GET } from '../route'

/**
 * El fichero de una remesa marca `fichero_generado_at` la primera vez (`20261120120000`).
 * La marca va ANTES de leer los recibos que van en el fichero: uno añadido entre la lectura y la
 * marca quedaría en la remesa sin estar en el fichero. Antes se comprueba que el fichero sale, para
 * no cerrar una remesa con un 422.
 *
 * El MsgId sale de la marca, no de la hora de la descarga (`message-id.ts`): dos descargas de la
 * misma versión llevan el mismo MsgId y el banco rechaza la segunda en vez de cobrarla otra vez.
 * Por eso se marca también la remesa enviada sin marca (las de antes de la columna). La ya marcada
 * se vuelve a bajar sin marcar.
 */

const { estado, pasos } = vi.hoisted(() => ({
  estado: {
    remesa: null as Record<string, unknown> | null,
    sale: true,
    errorMarca: null as unknown,
    // Lo que devuelve get_mandatos_remesa y las lecturas del concepto (forma de producción: el
    // recibo es de la familia y el niño sale de las líneas).
    mandatos: [] as Record<string, unknown>[],
    tablas: {} as Record<string, { data: unknown[]; error: unknown }>,
    conceptos: null as Map<string, string> | null,
    errorRelectura: null as unknown,
    // Lo que la BD tiene en la columna: el UPDATE la pone si está vacía, como `.is(..., null)`.
    marcaEnBd: null as string | null,
    // Lo que escribe otra descarga a la vez, entre nuestra lectura y nuestro UPDATE.
    marcaDeOtro: null as string | null,
    // La RLS deja el UPDATE en 0 filas sin error: no escribe.
    updateNoEscribe: false,
    msgIds: [] as string[],
  },
  pasos: [] as string[],
}))

vi.mock('@/features/remesas/lib/preparar-remesa', () => ({
  prepararRemesa: (
    _r: unknown,
    _a: unknown,
    meta: { messageId: string },
    conceptos: Map<string, string>
  ) => {
    estado.conceptos = conceptos
    estado.msgIds.push(meta.messageId)
    return estado.sale ? { ok: true, xml: '<xml/>' } : { ok: false, motivo: 'remesa_vacia' }
  },
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (tabla: string) => ({
      select: (cols: string) => ({
        eq: () => ({
          // La remesa (con `deleted_at`).
          is: () => ({
            maybeSingle: async () => ({
              data: estado.remesa && { ...estado.remesa, fichero_generado_at: estado.marcaEnBd },
            }),
          }),
          maybeSingle: async () => {
            if (tabla === 'centros') return { data: { nombre: 'CEI Ejemplo' } }
            // La relectura de la marca.
            expect(cols).toBe('fichero_generado_at')
            pasos.push('relee la marca')
            return { data: { fichero_generado_at: estado.marcaEnBd }, error: estado.errorRelectura }
          },
          in: async () => {
            pasos.push(`lee ${tabla}`)
            return estado.tablas[tabla] ?? { data: [], error: null }
          },
        }),
      }),
      update: (valores: { fichero_generado_at: string }) => ({
        eq: () => ({
          is: async () => {
            pasos.push(`marca ${tabla}`)
            if (estado.marcaDeOtro) estado.marcaEnBd = estado.marcaDeOtro
            if (!estado.errorMarca && !estado.updateNoEscribe && !estado.marcaEnBd)
              estado.marcaEnBd = valores.fichero_generado_at
            return { error: estado.errorMarca }
          },
        }),
      }),
    }),
    rpc: async (nombre: string) => {
      pasos.push(nombre)
      return { data: nombre === 'get_mandatos_remesa' ? estado.mandatos : [], error: null }
    },
  }),
}))

const ID = '11111111-1111-4111-8111-111111111111'
const pedir = () =>
  GET(new Request('http://x'), { params: Promise.resolve({ locale: 'es', id: ID }) })

describe('GET /admin/remesas/[id]/xml', () => {
  beforeEach(() => {
    estado.remesa = { id: ID, centro_id: 'c1', anio: 2026, mes: 3, estado: 'borrador' }
    estado.sale = true
    estado.errorMarca = null
    estado.mandatos = []
    estado.tablas = {}
    estado.conceptos = null
    estado.errorRelectura = null
    estado.marcaEnBd = null
    estado.marcaDeOtro = null
    estado.updateNoEscribe = false
    estado.msgIds = []
    pasos.length = 0
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('primera vez en borrador: comprueba, marca, relee la marca y vuelve a leer los recibos', async () => {
    const res = await pedir()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<xml/>')
    expect(pasos).toEqual([
      'get_mandatos_remesa',
      'get_datos_acreedor',
      'marca remesas',
      'relee la marca',
      'get_mandatos_remesa',
      'get_datos_acreedor',
    ])
  })

  it('dos descargas a horas distintas llevan el mismo MsgId: el de la marca', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-31T10:00:00Z'))
    expect((await pedir()).status).toBe(200)
    // Premisa: la primera descarga dejó la marca, de esa hora.
    expect(estado.marcaEnBd).toBe('2026-10-31T10:00:00.000Z')
    const primera = estado.msgIds.at(-1)

    vi.setSystemTime(new Date('2026-10-31T17:45:30Z'))
    estado.msgIds = []
    pasos.length = 0
    expect((await pedir()).status).toBe(200)
    // Premisa: la segunda es a otra hora y ya no marca.
    expect(pasos).not.toContain('marca remesas')
    expect(estado.msgIds).toEqual([primera])
    expect(primera).toBe('NIDO-11111111-20261031100000')
  })

  it('el fichero que se sirve lleva el MsgId de la marca, no el de la comprobación previa', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-31T10:00:00Z'))
    // Otra descarga marcó a la vez, antes que la nuestra: su marca es la que vale.
    estado.marcaDeOtro = '2026-10-31T09:59:58.000Z'
    expect((await pedir()).status).toBe(200)
    // La comprobación (hora de ahora) y el fichero servido (la marca de la otra descarga).
    expect(estado.msgIds).toEqual(['NIDO-11111111-20261031100000', 'NIDO-11111111-20261031095958'])
  })

  it('una remesa enviada sin marca la recibe en la descarga, y la siguiente lleva el mismo MsgId', async () => {
    estado.remesa = { ...estado.remesa, estado: 'enviada' }
    // Premisa: no tiene marca (enviada antes de que existiera la columna).
    expect(estado.marcaEnBd).toBeNull()
    expect((await pedir()).status).toBe(200)
    expect(pasos).toContain('marca remesas')
    const marca = estado.marcaEnBd
    expect(marca).not.toBeNull()
    const servido = estado.msgIds.at(-1)

    estado.msgIds = []
    pasos.length = 0
    expect((await pedir()).status).toBe(200)
    expect(pasos).not.toContain('marca remesas')
    expect(estado.msgIds).toEqual([servido])
  })

  it('ya marcada: se vuelve a bajar sin marcar, con el MsgId de su marca', async () => {
    estado.marcaEnBd = '2026-10-25T08:30:00.000Z'
    expect((await pedir()).status).toBe(200)
    expect(pasos).not.toContain('marca remesas')
    expect(estado.msgIds).toEqual(['NIDO-11111111-20261025083000'])
  })

  it('si el fichero no sale (422), no marca la remesa', async () => {
    estado.sale = false
    const res = await pedir()
    expect(res.status).toBe(422)
    expect(pasos).not.toContain('marca remesas')
  })

  it('desplegado antes que la migración (PGRST204): el fichero sale como antes, sin marca', async () => {
    estado.errorMarca = { code: 'PGRST204', message: 'column not found' }
    const res = await pedir()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<xml/>')
    expect(pasos).not.toContain('relee la marca')
    // Otro error al marcar sí corta: no se sirve un fichero de una remesa que no quedó cerrada.
    estado.errorMarca = { code: '42501', message: 'x' }
    expect((await pedir()).status).toBe(500)
  })

  it('si tras marcar no se puede leer la marca, 500: sin marca no hay MsgId estable', async () => {
    estado.errorRelectura = { code: 'XX000', message: 'x' }
    expect((await pedir()).status).toBe(500)
    // Y si la lectura no la devuelve (la RLS dejó el UPDATE en 0 filas, sin error), tampoco.
    estado.errorRelectura = null
    estado.marcaEnBd = null
    estado.updateNoEscribe = true
    pasos.length = 0
    expect((await pedir()).status).toBe(500)
    // Premisa: llegó a marcar y a releer; el 500 es por la marca ausente.
    expect(pasos).toContain('relee la marca')
    expect(estado.marcaEnBd).toBeNull()
  })

  describe('el concepto de cada adeudo', () => {
    const RECIBO = '0d06ffd1-d24e-4d6e-b1db-341d6c94bb26'
    const NINO = 'aaaaaaaa-0000-4000-8000-000000000001'

    beforeEach(() => {
      estado.remesa = { ...estado.remesa, estado: 'enviada' }
      estado.mandatos = [{ recibo_id: RECIBO }]
      estado.tablas = {
        recibos: { data: [{ id: RECIBO, anio: 2026, mes: 10 }], error: null },
        lineas_recibo: { data: [{ recibo_id: RECIBO, nino_id: NINO }], error: null },
        ninos: { data: [{ id: NINO, nombre: 'Niña', apellidos: 'Demo Uno' }], error: null },
      }
    })

    it('lleva el centro, el niño de las líneas y el mes del recibo', async () => {
      expect((await pedir()).status).toBe(200)
      expect(pasos).toEqual(
        expect.arrayContaining(['lee recibos', 'lee lineas_recibo', 'lee ninos'])
      )
      expect(estado.conceptos?.get(RECIBO)).toBe('CEI Ejemplo · Nina Demo Uno · Octubre 2026')
    })

    it('si falla una lectura del concepto, no sale el fichero (500)', async () => {
      estado.tablas.lineas_recibo = { data: [], error: { code: '42501', message: 'x' } }
      expect((await pedir()).status).toBe(500)
      expect(estado.conceptos).toBeNull()
    })
  })
})
