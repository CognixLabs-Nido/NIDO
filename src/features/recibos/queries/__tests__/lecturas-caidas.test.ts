import { beforeEach, describe, expect, it, vi } from 'vitest'

import { esLecturaFallida } from '@/shared/lib/lectura-fallida'

/**
 * Censo C (B1, lista blanca de `nido/lectura-mira-el-error`): las consultas de recibos tomaban una lectura
 * caída por «no hay». El panel del mes decía «sin familias» o «sin recibo», el mes abierto o «sin mandato»;
 * la tabla y su CSV salían sin recibos o con los importes a 0; el detalle y el PDF de la familia, con el
 * total y sin líneas. Ahora lanzan `LecturaFallida`: las páginas la pintan con su `error.tsx`, y el CSV y el
 * PDF contestan 500 (sus tests de ruta, abajo).
 *
 * Cada bloque empieza por su premisa: con todo leído, la consulta devuelve lo que se mide. Fixtures ficticios
 * del 2026-11-26.
 */
const { estado } = vi.hoisted(() => ({
  estado: {
    filas: {} as Record<string, unknown>,
    falla: null as { tabla: string; n: number } | null,
    lecturas: {} as Record<string, number>,
  },
}))

function cliente() {
  return {
    from: (tabla: string) => {
      const responder = (una: boolean) => {
        const n = (estado.lecturas[tabla] = (estado.lecturas[tabla] ?? 0) + 1)
        if (estado.falla?.tabla === tabla && estado.falla.n === n)
          return { data: null, error: { code: 'XX000', message: 'caída' } }
        const v = estado.filas[tabla] ?? null
        if (una) return { data: Array.isArray(v) ? (v[0] ?? null) : v, error: null }
        return { data: v === null ? [] : Array.isArray(v) ? v : [v], error: null }
      }
      const cadena: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'in', 'neq', 'order', 'limit'])
        cadena[m] = () => cadena
      cadena.maybeSingle = async () => responder(true)
      cadena.single = async () => responder(true)
      cadena.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(responder(false)).then(res, rej)
      return cadena
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => cliente() }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: () => cliente() }))

const { getPivotePeriodo } = await import('../get-pivote-periodo')
const { getReciboFamiliaDetalle } = await import('../get-recibo-familia-detalle')
const { getReciboParaPdf } = await import('../get-recibo-pdf-data')
const { getRecibosMesPanel } = await import('../get-recibos-mes-panel')

const ambito = { centroId: 'centro-1', hijos: [] } as unknown as Parameters<
  typeof getReciboParaPdf
>[0]

async function lanzaLecturaFallida(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (err: unknown) => err
  )
  expect(esLecturaFallida(e), `esperaba una LecturaFallida, llegó ${String(e)}`).toBe(true)
}

const RECIBO = {
  id: 'r-1',
  familia_id: 'f-1',
  nino_id: null,
  centro_id: 'centro-1',
  anio: 2026,
  mes: 11,
  estado: 'pendiente_procesar',
  metodo: 'sepa',
  total_centimos: 6000,
  es_esporadico: false,
  concepto_esporadico: null,
  devuelto_de_recibo_id: null,
  fecha_envio_banco: null,
  fecha_devolucion: null,
}

beforeEach(() => {
  estado.falla = null
  estado.lecturas = {}
  estado.filas = {
    recibos: [RECIBO],
    lineas_recibo: [
      {
        id: 'l-1',
        recibo_id: 'r-1',
        nino_id: 'n-1',
        concepto_id: 'c-1',
        descripcion: 'Cuota',
        cantidad: 1,
        precio_unitario_centimos: 6000,
        importe_centimos: 6000,
        origen: 'automatico',
        arrastre_de_recibo_id: null,
        sobrante_de_desborde_id: null,
      },
    ],
    ninos: [{ id: 'n-1', nombre: 'Niño', apellidos: 'Demo', familia_id: 'f-1' }],
    familias: [{ id: 'f-1', etiqueta: 'Familia Demo', metodo_pago: 'sepa' }],
    familia_tutores: [
      { familia_id: 'f-1', rol_familia: 'titular', nombre_completo: 'Tutora Demo', usuario: null },
    ],
    conceptos_cobro: [{ id: 'c-1', nombre: 'Cuota' }],
    centros: { nombre: 'CEI Ejemplo', logo_url: null },
    cierre_mensual: null,
    metodo_pago_familia: [],
    mandatos_sepa: [{ familia_id: 'f-1' }],
    beca_comedor_desborde: [],
    recibos_remesa: [],
  }
})

describe('getPivotePeriodo (la tabla del mes y su CSV)', () => {
  it('premisa: con todo leído, sale el recibo con su importe', async () => {
    expect(JSON.stringify(await getPivotePeriodo('centro-1', 2026, 11))).toContain('6000')
  })

  it.each(['recibos', 'lineas_recibo', 'familias', 'familia_tutores', 'conceptos_cobro'])(
    'con %s caída: no sale vacía ni a 0, lanza',
    async (tabla) => {
      estado.falla = { tabla, n: 1 }
      await lanzaLecturaFallida(getPivotePeriodo('centro-1', 2026, 11))
    }
  )
})

describe('el recibo de la familia (detalle y PDF)', () => {
  it('premisa: con todo leído, el detalle y el PDF llevan la línea y el nombre del niño', async () => {
    expect(JSON.stringify(await getReciboFamiliaDetalle(ambito, 'r-1'))).toContain('Niño Demo')
    expect(JSON.stringify(await getReciboParaPdf(ambito, 'r-1'))).toContain('CEI Ejemplo')
  })

  it.each(['recibos', 'lineas_recibo', 'ninos'])(
    'detalle con %s caída: no sale sin líneas, lanza',
    async (tabla) => {
      estado.falla = { tabla, n: 1 }
      await lanzaLecturaFallida(getReciboFamiliaDetalle(ambito, 'r-1'))
    }
  )

  it.each(['recibos', 'lineas_recibo', 'ninos', 'conceptos_cobro', 'centros'])(
    'PDF con %s caída: no sale incompleto, lanza',
    async (tabla) => {
      estado.falla = { tabla, n: 1 }
      await lanzaLecturaFallida(getReciboParaPdf(ambito, 'r-1'))
    }
  )
})

describe('getRecibosMesPanel', () => {
  it('premisa: con todo leído, la familia sale con su recibo, su mandato y el mes abierto', async () => {
    const p = await getRecibosMesPanel('centro-1', 2026, 11)
    expect(p.cerrado).toBe(false)
    expect(p.familiasConMandato).toEqual(['f-1'])
    expect(JSON.stringify(p)).toContain('r-1')
    expect(estado.lecturas.lineas_recibo, 'premisa: leyó las líneas').toBe(1)
    expect(estado.lecturas.recibos_remesa, 'premisa: leyó las remesas').toBe(1)
  })

  it.each([
    'ninos',
    'familias',
    'familia_tutores',
    'recibos',
    'cierre_mensual',
    'metodo_pago_familia',
    'mandatos_sepa',
    'lineas_recibo',
    'beca_comedor_desborde',
    'recibos_remesa',
  ])('con %s caída: el panel no miente, lanza', async (tabla) => {
    estado.falla = { tabla, n: 1 }
    await lanzaLecturaFallida(getRecibosMesPanel('centro-1', 2026, 11))
  })
})
