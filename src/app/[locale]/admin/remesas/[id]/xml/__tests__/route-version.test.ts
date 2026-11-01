import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GET } from '../route'

/**
 * La versión del fichero, con el generador de verdad (`route.test.ts` lo sustituye por un doble):
 * dos descargas en días distintos, sin cambios en los datos, dan el mismo fichero byte a byte.
 * Todo lo que no sale de los recibos sale de la marca: el MsgId, `CreDtTm` y la fecha de cobro de
 * los recibos que no tienen la suya. Un bloque por fecha.
 *
 * Que la fecha de un recibo no cambie con la marca puesta no lo prueba este fichero: lo hace la BD
 * (`recibos_fecha_cobro_proteger`, `recibo-fecha-cobro.rls.test.ts`).
 */

const ID = '11111111-1111-4111-8111-111111111111'
const R_SIN_FECHA = '0d06ffd1-d24e-4d6e-b1db-341d6c94bb26'
const R_CON_FECHA = '290f1adf-67ab-4273-9af3-2b4d9f39b323'
const NINO_1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const NINO_2 = 'aaaaaaaa-0000-4000-8000-000000000002'

const { bd } = vi.hoisted(() => ({
  bd: {
    marca: null as string | null,
    fechas: {} as Record<string, string | null>,
  },
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
                estado: 'borrador',
                fichero_generado_at: bd.marca,
              },
            }),
          }),
          maybeSingle: async () =>
            tabla === 'centros'
              ? { data: { nombre: 'CEI Ejemplo' } }
              : { data: { fichero_generado_at: bd.marca }, error: null },
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
              return {
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
      update: (valores: { fichero_generado_at: string }) => ({
        eq: () => ({
          is: async () => {
            if (!bd.marca) bd.marca = valores.fichero_generado_at
            return { error: null }
          },
        }),
      }),
    }),
    rpc: async (nombre: string) =>
      nombre === 'get_mandatos_remesa'
        ? {
            // Forma de la RPC; dos familias, cada una con su recibo.
            data: [
              {
                recibo_id: R_SIN_FECHA,
                familia_id: 'f1',
                familia_etiqueta: 'Familia Demo Uno',
                total_centimos: 12000,
                identificador_mandato: 'NIDO-33C79B50-87319A17-MH3K2Q8L',
                iban: 'ES7620770024003102575766',
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
        : {
            data: [
              {
                identificador_acreedor: 'ES00ZZZ00000000000',
                bic_acreedor: 'CAIXESBBXXX',
                iban: 'ES9121000418450200051332',
              },
            ],
            error: null,
          },
  }),
}))

const descargar = async () => {
  const res = await GET(new Request('http://x'), {
    params: Promise.resolve({ locale: 'es', id: ID }),
  })
  expect(res.status).toBe(200)
  return res.text()
}

describe('la versión del fichero de una remesa', () => {
  beforeEach(() => {
    bd.marca = null
    bd.fechas = {}
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('dos descargas en días distintos, sin cambios, dan el mismo fichero byte a byte', async () => {
    vi.setSystemTime(new Date('2026-11-02T09:15:00Z'))
    const lunes = await descargar()
    // Premisa: la primera descarga dejó la marca, de esa hora.
    expect(bd.marca).toBe('2026-11-02T09:15:00.000Z')

    vi.setSystemTime(new Date('2026-11-05T18:40:00Z'))
    const jueves = await descargar()
    expect(jueves).toBe(lunes)
    // Lo que antes dependía de la descarga sale de la marca.
    expect(lunes).toContain('<CreDtTm>2026-11-02T09:15:00</CreDtTm>')
    expect(lunes).toContain('<ReqdColltnDt>2026-11-02</ReqdColltnDt>')
    expect(lunes).not.toContain('2026-11-05')
  })

  it('con una fecha propia, dos bloques; el resto, el día de la marca y no el de la descarga', async () => {
    bd.fechas = { [R_CON_FECHA]: '2026-11-10' }
    // 23:30 UTC del día 2 son las 00:30 del día 3 en Madrid: el día de la versión es el 3.
    vi.setSystemTime(new Date('2026-11-02T23:30:00Z'))
    const primera = await descargar()
    vi.setSystemTime(new Date('2026-11-06T08:00:00Z'))
    expect(await descargar()).toBe(primera)

    const bloques = [...primera.matchAll(/<PmtInf>([\s\S]*?)<\/PmtInf>/g)].map(([, b]) => [
      b.match(/<PmtInfId>(.*?)</)![1],
      b.match(/<ReqdColltnDt>(.*?)</)![1],
      b.match(/<CtrlSum>(.*?)</)![1],
    ])
    expect(bloques).toEqual([
      ['NIDO-11111111-20261102233000-1', '2026-11-03', '120.00'],
      ['NIDO-11111111-20261102233000-2', '2026-11-10', '80.50'],
    ])
    expect(primera).toContain('<CtrlSum>200.50</CtrlSum>')
  })
})
