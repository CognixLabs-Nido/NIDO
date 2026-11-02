import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GET } from '../route'

/**
 * La descarga del fichero de una remesa, con el generador de verdad y una base y un bucket de
 * mentira que hacen lo que hacen los de verdad (`20261220120000`):
 *  - `registrar_fichero_remesa` pone la marca si no hay, rechaza otra marca, exige el fichero en el
 *    bucket y los recibos cobrables de la remesa, y guarda el registro;
 *  - `fichero_remesa_vigente` devuelve el de la marca actual.
 *
 * Desde R-1 (decisión P-1 del 2026-11-01, que sustituye a G1, «regenerable») el fichero se guarda
 * la primera vez y las descargas siguientes entregan ESE, byte a byte: generado otra vez podía
 * llevar otro IBAN, porque `get_mandatos_remesa` toma el mandato activo en cada descarga.
 * Lo que la base de verdad hace con cada caso lo prueba `remesa-ficheros.rls.test.ts`.
 */

const ID = '11111111-1111-4111-8111-111111111111'
const R_SIN_FECHA = '0d06ffd1-d24e-4d6e-b1db-341d6c94bb26'
const R_CON_FECHA = '290f1adf-67ab-4273-9af3-2b4d9f39b323'
const NINO_1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const NINO_2 = 'aaaaaaaa-0000-4000-8000-000000000002'

interface Registro {
  marca: string
  ruta: string
  sha256: string
  adeudos: unknown
}

const { bd } = vi.hoisted(() => ({
  bd: {
    marca: null as string | null,
    fechas: {} as Record<string, string | null>,
    iban1: 'ES7620770024003102575766',
    acreedorCompleto: true,
    errorLineas: null as unknown,
    // Lo que tiene la remesa al registrar (los recibos cobrables).
    recibosEnRemesa: [] as string[],
    registros: [] as Registro[],
    bucket: new Map<string, string>(),
    llamadas: [] as string[],
  },
}))

vi.mock('@/shared/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    storage: {
      from: () => ({
        upload: async (ruta: string, xml: string, o: { upsert: boolean }) => {
          bd.llamadas.push('sube')
          if (!o.upsert && bd.bucket.has(ruta))
            return { error: { statusCode: '409', message: 'The resource already exists' } }
          bd.bucket.set(ruta, xml)
          return { error: null }
        },
        download: async (ruta: string) => {
          bd.llamadas.push('baja')
          const xml = bd.bucket.get(ruta)
          return xml === undefined
            ? { data: null, error: { message: 'not found' } }
            : { data: new Blob([xml]), error: null }
        },
        remove: async (rutas: string[]) => {
          bd.llamadas.push('borra')
          for (const r of rutas) bd.bucket.delete(r)
          return { error: null }
        },
      }),
    },
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (tabla: string) => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: async () => ({
              data: {
                id: ID,
                centro_id: 'c1',
                anio: 2026,
                mes: 10,
                fichero_generado_at: bd.marca,
              },
            }),
          }),
          maybeSingle: async () => ({ data: { nombre: 'CEI Ejemplo' } }),
          in: async () => {
            if (tabla === 'recibos')
              return {
                data: [R_SIN_FECHA, R_CON_FECHA].map((id) => ({
                  id,
                  anio: 2026,
                  mes: 10,
                  fecha_cobro_banco: bd.fechas[id] ?? null,
                })),
                error: null,
              }
            if (tabla === 'lineas_recibo')
              return bd.errorLineas
                ? { data: null, error: bd.errorLineas }
                : {
                    data: [
                      { recibo_id: R_SIN_FECHA, nino_id: NINO_1 },
                      { recibo_id: R_CON_FECHA, nino_id: NINO_2 },
                    ],
                    error: null,
                  }
            return {
              data: [
                { id: NINO_1, nombre: 'Nino', apellidos: 'Demo Uno' },
                { id: NINO_2, nombre: 'Nina', apellidos: 'Demo Dos' },
              ],
              error: null,
            }
          },
        }),
      }),
    }),
    rpc: async (nombre: string, a: Record<string, unknown>) => {
      bd.llamadas.push(nombre)
      if (nombre === 'get_mandatos_remesa')
        return {
          data: [
            {
              recibo_id: R_SIN_FECHA,
              familia_id: 'f1',
              familia_etiqueta: 'Familia Demo Uno',
              total_centimos: 12000,
              identificador_mandato: 'NIDO-33C79B50-87319A17-MH3K2Q8L',
              iban: bd.iban1,
              titular: 'Tutor Demo Uno',
              fecha_mandato: '2026-06-01',
            },
            {
              recibo_id: R_CON_FECHA,
              familia_id: 'f2',
              familia_etiqueta: 'Familia Demo Dos',
              total_centimos: 8050,
              identificador_mandato: 'NIDO-33C79B50-8F54B0D9-MH3K2Q8M',
              iban: 'ES1000492352082414205416',
              titular: 'Tutor Demo Dos',
              fecha_mandato: '2026-06-02',
            },
          ],
          error: null,
        }
      if (nombre === 'get_datos_acreedor')
        return {
          data: [
            {
              identificador_acreedor: bd.acreedorCompleto ? 'ES00ZZZ00000000000' : null,
              bic_acreedor: 'CAIXESBBXXX',
              iban: 'ES9121000418450200051332',
            },
          ],
          error: null,
        }
      if (nombre === 'fichero_remesa_vigente') {
        const r = bd.registros.find((x) => x.marca === bd.marca)
        return { data: r ? [{ ruta: r.ruta, sha256: r.sha256 }] : [], error: null }
      }
      if (nombre === 'registrar_fichero_remesa') {
        const fallo = (hint: string) => ({ data: null, error: { message: hint, hint } })
        const marca = a.p_marca as string
        if (bd.marca && bd.marca !== marca) return fallo('marca_distinta')
        if (!bd.bucket.has(a.p_ruta as string)) return fallo('sin_fichero')
        const ids = (a.p_adeudos as Array<{ recibo_id: string }>).map((x) => x.recibo_id).sort()
        if (ids.join() !== [...bd.recibosEnRemesa].sort().join()) return fallo('recibos_cambiaron')
        bd.marca = marca
        bd.registros.push({
          marca,
          ruta: a.p_ruta as string,
          sha256: a.p_sha256 as string,
          adeudos: a.p_adeudos,
        })
        return { data: 'f1', error: null }
      }
      throw new Error(`rpc inesperada: ${nombre}`)
    },
  }),
}))

const pedir = () =>
  GET(new Request('http://x'), { params: Promise.resolve({ locale: 'es', id: ID }) })

const descargar = async () => {
  const res = await pedir()
  expect(res.status).toBe(200)
  return res.text()
}

describe('GET /admin/remesas/[id]/xml: el fichero de cada versión, guardado (R-1)', () => {
  beforeEach(() => {
    bd.marca = null
    bd.fechas = {}
    bd.iban1 = 'ES7620770024003102575766'
    bd.acreedorCompleto = true
    bd.errorLineas = null
    bd.recibosEnRemesa = [R_SIN_FECHA, R_CON_FECHA]
    bd.registros = []
    bd.bucket = new Map()
    bd.llamadas = []
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('la primera descarga guarda el fichero y su registro, con la marca de esa hora', async () => {
    vi.setSystemTime(new Date('2026-11-02T09:15:00.456Z'))
    const xml = await descargar()
    const ruta = `c1/${ID}/NIDO-11111111-20261102091500.xml`
    expect(bd.marca).toBe('2026-11-02T09:15:00.000Z')
    expect([...bd.bucket.keys()]).toEqual([ruta])
    expect(bd.bucket.get(ruta)).toBe(xml)
    // El registro: por adeudo, el recibo, su EndToEndId, el importe y el MndtId. Sin IBAN.
    expect(bd.registros[0].adeudos).toEqual([
      {
        recibo_id: R_SIN_FECHA,
        end_to_end_id: '0D06FFD1D24E4D6EB1DB341D6C94BB26',
        importe_centimos: 12000,
        mndt_id: 'NIDO-33C79B50-87319A17-MH3K2Q8L',
      },
      {
        recibo_id: R_CON_FECHA,
        end_to_end_id: '290F1ADF67AB42739AF32B4D9F39B323',
        importe_centimos: 8050,
        mndt_id: 'NIDO-33C79B50-8F54B0D9-MH3K2Q8M',
      },
    ])
    expect(JSON.stringify(bd.registros)).not.toMatch(/ES76|ES10/)
    expect(xml).toContain('<CreDtTm>2026-11-02T09:15:00</CreDtTm>')
  })

  it('las siguientes entregan el guardado, aunque la familia haya cambiado de IBAN (P-1)', async () => {
    vi.setSystemTime(new Date('2026-11-02T09:15:00Z'))
    const lunes = await descargar()
    // Premisa: el IBAN va en el fichero.
    expect(lunes).toContain('ES7620770024003102575766')

    bd.iban1 = 'ES6000491500051234567892'
    bd.llamadas = []
    vi.setSystemTime(new Date('2026-11-05T18:40:00Z'))
    const jueves = await descargar()
    expect(jueves).toBe(lunes)
    expect(jueves).not.toContain('ES6000491500051234567892')
    // No se vuelve a generar: ni se leen los mandatos.
    expect(bd.llamadas).toEqual(['fichero_remesa_vigente', 'baja'])
  })

  it('con una fecha propia, dos bloques; el resto, el día de la marca en Madrid', async () => {
    bd.fechas = { [R_CON_FECHA]: '2026-11-10' }
    // 23:30 UTC del día 2 son las 00:30 del día 3 en Madrid: el día de la versión es el 3.
    vi.setSystemTime(new Date('2026-11-02T23:30:00Z'))
    const primera = await descargar()
    const bloques = [...primera.matchAll(/<PmtInf>([\s\S]*?)<\/PmtInf>/g)].map(([, b]) => [
      b.match(/<PmtInfId>(.*?)</)![1],
      b.match(/<ReqdColltnDt>(.*?)</)![1],
      b.match(/<CtrlSum>(.*?)</)![1],
    ])
    expect(bloques).toEqual([
      ['NIDO-11111111-20261102233000-1', '2026-11-03', '120.00'],
      ['NIDO-11111111-20261102233000-2', '2026-11-10', '80.50'],
    ])
  })

  it('si el fichero no sale (422), no sube, no registra y no marca', async () => {
    bd.acreedorCompleto = false
    const res = await pedir()
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'acreedor_incompleto' })
    expect(bd.marca).toBeNull()
    expect(bd.bucket.size).toBe(0)
    expect(bd.llamadas).not.toContain('registrar_fichero_remesa')
  })

  it('si los recibos de la remesa cambiaron, 409 y no queda nada guardado', async () => {
    bd.recibosEnRemesa = [R_SIN_FECHA]
    const res = await pedir()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'remesa_cambio' })
    expect(bd.marca).toBeNull()
    expect(bd.bucket.size).toBe(0)
  })

  it('una marca de antes de R-1, sin fichero guardado, guarda el de esa marca y no la cambia', async () => {
    bd.marca = '2026-10-20T08:00:00.000Z'
    vi.setSystemTime(new Date('2026-11-02T09:15:00Z'))
    const xml = await descargar()
    expect(bd.marca).toBe('2026-10-20T08:00:00.000Z')
    expect(xml).toContain('<MsgId>NIDO-11111111-20261020080000</MsgId>')
    expect(bd.registros).toHaveLength(1)
  })

  describe('el concepto de cada adeudo', () => {
    it('lleva el centro, el niño de las líneas y el mes del recibo', async () => {
      expect(await descargar()).toMatch(
        /<Ustrd>CEI Ejemplo . Nino Demo Uno . Octubre 2026<\/Ustrd>/
      )
    })

    it('si falla una lectura del concepto, no sale el fichero (500) ni se guarda nada', async () => {
      bd.errorLineas = { code: '42501', message: 'x' }
      expect((await pedir()).status).toBe(500)
      expect(bd.bucket.size).toBe(0)
      expect(bd.marca).toBeNull()
    })
  })
})
