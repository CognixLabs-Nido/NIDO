import { beforeEach, describe, expect, it, vi } from 'vitest'

import { esLecturaFallida } from '@/shared/lib/lectura-fallida'

/**
 * Censo C (B1, lista blanca, 2026-11-26): las consultas de remesas con una lectura caída. Antes:
 *  - los remesables: «no hay recibos»; sin los ya remesados, uno ya enviado salía remesable; sin los
 *    mandatos, la familia «sin mandato»; sin familias o tutores, sin nombre;
 *  - la gestión de cobros: «nada que gestionar», sin etiqueta, «sin mandato», una devolución sin adónde
 *    llevarla, un mes cerrado que no lo era, el sobrante de un cheque perdido (cuatro de estas lecturas
 *    van en ternarios y la regla de lint no las ve);
 *  - los datos del acreedor: el formulario en blanco.
 * Ahora lanzan `LecturaFallida`. Cada bloque empieza por su premisa. Fixtures ficticios.
 */
const { estado } = vi.hoisted(() => ({
  estado: {
    filas: {} as Record<string, unknown[]>,
    vistas: {} as Record<string, number>,
    falla: null as { tabla: string; n: number } | null,
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (tabla: string) => {
      const responder = (una: boolean) => {
        const n = (estado.vistas[tabla] = (estado.vistas[tabla] ?? 0) + 1)
        if (estado.falla?.tabla === tabla && estado.falla.n === n)
          return { data: null, error: { code: 'XX000', message: 'caída' } }
        const lista = estado.filas[tabla] ?? [[]]
        const v = lista[Math.min(n, lista.length) - 1]
        if (una) return { data: Array.isArray(v) ? (v[0] ?? null) : v, error: null }
        return { data: v, error: null }
      }
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'in', 'neq', 'gt', 'order']) c[m] = () => c
      c.maybeSingle = async () => responder(true)
      c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(responder(false)).then(res, rej)
      return c
    },
  }),
}))

const { getRecibosSepaRemesables } = await import('../get-recibos-sepa-remesables')
const { getRecibosGestion } = await import('../get-recibos-gestion')
const { getDatosAcreedor } = await import('../get-datos-acreedor')

async function lanzaEn(p: Promise<unknown>, donde: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err
  )
  expect(esLecturaFallida(e), `esperaba una LecturaFallida, llegó ${String(e)}`).toBe(true)
  expect((e as { donde: string }).donde).toBe(donde)
}

const base = {
  anio: 2026,
  mes: 10,
  es_esporadico: false,
  concepto_esporadico: null,
  fecha_envio_banco: null,
  fecha_devolucion: null,
  devuelto_de_recibo_id: null,
  cobro_forma: null,
  cobro_fecha: null,
  cobro_nota: null,
  cobro_importe_centimos: null,
  diferencia_de_recibo_id: null,
  devolucion_gastos_centimos: null,
  devolucion_salida: null,
}
// Tres recibos que se gestionan, uno por cada camino que abre una lectura: una devolución por resolver,
// otra llevada al recibo siguiente y un cobro con cheque mayor que el recibo.
const GESTION = [
  {
    ...base,
    id: 'r-dev',
    familia_id: 'f-1',
    total_centimos: 5000,
    estado: 'devuelto',
    metodo: 'sepa',
  },
  {
    ...base,
    id: 'r-arr',
    familia_id: 'f-1',
    total_centimos: 5000,
    estado: 'devuelto',
    metodo: 'sepa',
    devolucion_salida: 'siguiente_recibo',
  },
  {
    ...base,
    id: 'r-che',
    familia_id: 'f-1',
    total_centimos: 5000,
    estado: 'cobrado_manual',
    metodo: 'cheque_guarderia',
    cobro_importe_centimos: 6000,
  },
]

beforeEach(() => {
  estado.falla = null
  estado.vistas = {}
  estado.filas = {
    recibos: [
      GESTION,
      // 2.ª lectura (gestión): el recibo regular de noviembre de la familia.
      [{ familia_id: 'f-1', anio: 2026, mes: 11, estado: 'borrador' }],
    ],
    familias: [[{ id: 'f-1', etiqueta: 'Familia Demo' }]],
    mandatos_sepa: [[{ familia_id: 'f-1' }]],
    cierre_mensual: [[{ anio: 2026, mes: 9 }]],
    lineas_recibo: [[{ arrastre_de_recibo_id: 'r-arr', recibo: { anio: 2026, mes: 11 } }]],
    beca_comedor_desborde: [[{ recibo_id: 'r-che', origen: 'cheque', estado: 'pendiente' }]],
    recibos_remesa: [[]],
    familia_tutores: [
      [
        {
          familia_id: 'f-1',
          rol_familia: 'titular',
          nombre_completo: 'Tutora Demo',
          usuario: null,
        },
      ],
    ],
    centros: [
      [
        {
          identificador_acreedor: 'ES00ZZZ000',
          bic_acreedor: 'XXXXESMM',
          iban_acreedor_cifrado: 'x',
        },
      ],
    ],
  }
})

describe('getRecibosSepaRemesables', () => {
  beforeEach(() => {
    estado.filas.recibos = [
      [
        {
          id: 'r-1',
          familia_id: 'f-1',
          total_centimos: 5000,
          es_esporadico: false,
          fecha_cobro_banco: null,
        },
      ],
    ]
  })

  it('premisa: con todo leído, el recibo sale con su familia, su tutora y su mandato', async () => {
    const r = JSON.stringify(await getRecibosSepaRemesables('c-1', 2026, 10))
    for (const x of ['r-1', 'Familia Demo', 'Tutora Demo']) expect(r).toContain(x)
  })

  it.each([
    ['recibos', 'remesables: recibos'],
    ['recibos_remesa', 'remesables: ya en remesa'],
    ['mandatos_sepa', 'remesables: mandatos'],
    ['familias', 'remesables: familias'],
    ['familia_tutores', 'remesables: tutores'],
  ])('con %s caída: lanza en «%s»', async (tabla, donde) => {
    estado.falla = { tabla, n: 1 }
    await lanzaEn(getRecibosSepaRemesables('c-1', 2026, 10), donde)
  })
})

describe('getRecibosGestion', () => {
  it('premisa: con todo leído, se leen las siete (también las de los ternarios)', async () => {
    const r = await getRecibosGestion('c-1', 2026, 10)
    expect(r).toHaveLength(3)
    expect(JSON.stringify(r)).toContain('Familia Demo')
    for (const t of [
      'familias',
      'mandatos_sepa',
      'cierre_mensual',
      'lineas_recibo',
      'beca_comedor_desborde',
    ])
      expect(estado.vistas[t], `premisa: leyó ${t}`).toBe(1)
    expect(estado.vistas.recibos, 'premisa: leyó los recibos y el regular').toBe(2)
  })

  it.each([
    ['recibos', 1, 'gestión de cobros: recibos'],
    ['familias', 1, 'gestión de cobros: familias'],
    ['mandatos_sepa', 1, 'gestión de cobros: mandatos'],
    ['recibos', 2, 'gestión de cobros: recibo regular'],
    ['cierre_mensual', 1, 'gestión de cobros: cierres'],
    ['lineas_recibo', 1, 'gestión de cobros: arrastres'],
    ['beca_comedor_desborde', 1, 'gestión de cobros: sobrantes de cheque'],
  ] as const)('con la lectura %s n.º %s caída: lanza en «%s»', async (tabla, n, donde) => {
    estado.falla = { tabla, n }
    await lanzaEn(getRecibosGestion('c-1', 2026, 10), donde)
  })
})

describe('getDatosAcreedor', () => {
  it('premisa: con todo leído, el CID y el IBAN configurado', async () => {
    expect(await getDatosAcreedor('c-1')).toMatchObject({
      identificadorAcreedor: 'ES00ZZZ000',
      ibanConfigurado: true,
    })
  })

  it('sin leerlo: no sale en blanco, lanza', async () => {
    estado.falla = { tabla: 'centros', n: 1 }
    await lanzaEn(getDatosAcreedor('c-1'), 'datos del acreedor')
  })
})
