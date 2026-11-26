import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Censo C (B1, lista blanca): las líneas manuales de un recibo con una lectura caída.
 *  - `reciboBorradorRegular` y `lineaDeBorrador` daban `null` y la acción decía «no es un borrador» (un
 *    motivo falso). Ahora lanzan y la acción contesta `common.lectura_fallida`, sin escribir.
 *  - crear el recibo de una familia sin recibo no miraba si la lectura de «¿ya existe?» había fallado.
 *  - si la línea no entraba, el recibo recién creado se retiraba sin mirar si se retiraba: quedaba un recibo
 *    sin líneas y la acción decía solo «no se pudo». Ahora lo dice.
 * Cada caso empieza por su premisa. Fixtures ficticios del 2026-11-26.
 */
const { estado } = vi.hoisted(() => ({
  estado: {
    filas: {} as Record<string, unknown>,
    falla: null as string | null,
    fallaEscritura: {} as Record<string, unknown>,
    escrituras: [] as string[],
  },
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/features/centros/contexto/roles-del-usuario', () => ({
  usuarioAdminEn: async () => true,
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: async () => ({ data: false, error: null }),
    from: (tabla: string) => {
      let op = 'select'
      const responder = (una: boolean) => {
        if (op !== 'select') {
          estado.escrituras.push(`${op} ${tabla}`)
          const err = estado.fallaEscritura[`${op} ${tabla}`] ?? null
          return { data: err ? null : { id: `nuevo-${tabla}` }, error: err }
        }
        if (estado.falla === tabla)
          return { data: null, error: { code: 'XX000', message: 'caída' } }
        const v = estado.filas[tabla] ?? null
        if (una) return { data: Array.isArray(v) ? (v[0] ?? null) : v, error: null }
        return { data: v === null ? [] : Array.isArray(v) ? v : [v], error: null }
      }
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'in', 'order']) c[m] = () => c
      c.insert = () => ((op = 'insert'), c)
      c.update = () => ((op = 'update'), c)
      c.delete = () => ((op = 'delete'), c)
      c.maybeSingle = async () => responder(true)
      c.single = async () => responder(true)
      c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(responder(false)).then(res, rej)
      return c
    },
  }),
}))

const { anadirLineaRecibo, editarLineaRecibo, borrarLineaRecibo, crearReciboConLineaManual } =
  await import('../lineas-recibo')

const ID = '00000000-0000-4000-8000-000000000001'
const LECTURA_FALLIDA = { success: false, error: 'common.lectura_fallida' }
const linea = { descripcion: 'Extra', cantidad: 1, precioUnitarioCentimos: 1000 }

beforeEach(() => {
  estado.falla = null
  estado.fallaEscritura = {}
  estado.escrituras = []
  estado.filas = {
    recibos: {
      id: ID,
      centro_id: 'centro-1',
      estado: 'borrador',
      es_esporadico: false,
      devuelto_de_recibo_id: null,
    },
    lineas_recibo: [{ recibo_id: ID, importe_centimos: 1000 }],
    familias: { id: ID, centro_id: 'centro-1', metodo_pago: 'transferencia' },
  }
})

describe('añadir, editar y borrar una línea', () => {
  const acciones = {
    anadir: () => anadirLineaRecibo({ reciboId: ID, ...linea }),
    editar: () => editarLineaRecibo({ lineaId: ID, ...linea }),
    borrar: () => borrarLineaRecibo({ lineaId: ID }),
  }

  it('premisa: con el borrador leído, las tres escriben la línea y el total', async () => {
    for (const [nombre, accion] of Object.entries(acciones)) {
      estado.escrituras = []
      expect((await accion()).success, nombre).toBe(true)
      expect(estado.escrituras.length, nombre).toBeGreaterThanOrEqual(2)
    }
  })

  it.each([
    ['anadir', 'recibos'],
    ['editar', 'lineas_recibo'],
    ['editar', 'recibos'],
    ['borrar', 'lineas_recibo'],
    ['borrar', 'recibos'],
  ] as const)('%s con %s caída: no dice «no es un borrador», y no escribe', async (a, tabla) => {
    estado.falla = tabla
    expect(await acciones[a]()).toEqual(LECTURA_FALLIDA)
    expect(estado.escrituras).toEqual([])
  })
})

describe('crear el recibo de una familia sin recibo', () => {
  const crear = () => crearReciboConLineaManual({ familiaId: ID, anio: 2026, mes: 11, ...linea })

  beforeEach(() => {
    estado.filas.recibos = null // no hay recibo de la familia en el mes
  })

  it('premisa: sin recibo, lo crea con la línea', async () => {
    expect((await crear()).success).toBe(true)
    expect(estado.escrituras.slice(0, 2)).toEqual(['insert recibos', 'insert lineas_recibo'])
  })

  it('sin poder mirar si ya existe: no crea, lo dice', async () => {
    estado.falla = 'recibos'
    expect(await crear()).toEqual(LECTURA_FALLIDA)
    expect(estado.escrituras).toEqual([])
  })

  it('premisa de la limpieza: si la línea no entra y el recibo se retira, «no se pudo»', async () => {
    estado.fallaEscritura['insert lineas_recibo'] = { code: 'XX000', message: 'no' }
    expect(await crear()).toEqual({ success: false, error: 'recibos_panel.errors.linea_failed' })
    expect(estado.escrituras).toContain('delete recibos')
  })

  it('si la línea no entra y el recibo tampoco se retira: dice que quedó creado y vacío', async () => {
    estado.fallaEscritura['insert lineas_recibo'] = { code: 'XX000', message: 'no' }
    estado.fallaEscritura['delete recibos'] = { code: 'XX000', message: 'no' }
    expect(await crear()).toEqual({
      success: false,
      error: 'recibos_panel.errors.recibo_vacio_creado',
    })
  })
})
