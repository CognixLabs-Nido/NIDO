import { beforeEach, describe, expect, it, vi } from 'vitest'

import { esLecturaFallida } from '@/shared/lib/lectura-fallida'

/**
 * Censo C (B1, lista blanca, 2026-11-26): las cargas y las transferencias de beca con una lectura caída.
 * Antes: «sin cargas», un mes cerrado o una carga con su recibo validado que salían EDITABLES, los alumnos
 * sin nombre; y «no hay transferencias pendientes» (dinero de familias) con solo un `warn`. Ahora lanzan
 * `LecturaFallida` y la pinta `admin/error.tsx`. Cada bloque empieza por su premisa. Fixtures ficticios.
 */
const { estado } = vi.hoisted(() => ({
  estado: { filas: {} as Record<string, unknown>, falla: null as string | null },
}))

vi.mock('@/features/cursos/queries/get-cursos', () => ({
  getCursoActivo: async () => ({
    id: 'curso-1',
    nombre: '26-27',
    fecha_inicio: '2026-09-01',
    fecha_fin: '2027-06-30',
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (tabla: string) => {
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'in', 'neq', 'order']) c[m] = () => c
      c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(
          estado.falla === tabla
            ? { data: null, error: { code: 'XX000', message: 'caída' } }
            : { data: estado.filas[tabla] ?? [], error: null }
        ).then(res, rej)
      return c
    },
  }),
}))

const { getCargasBeca } = await import('../get-cargas-beca')
const { getTransferenciasBeca } = await import('../get-transferencias-beca')

async function lanzaEn(p: Promise<unknown>, donde: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err
  )
  expect(esLecturaFallida(e), `esperaba una LecturaFallida, llegó ${String(e)}`).toBe(true)
  expect((e as { donde: string }).donde).toBe(donde)
}

beforeEach(() => {
  estado.falla = null
  estado.filas = {
    beca_comedor_tramo: [
      {
        nino_id: 'n1',
        anio_correspondiente: 2026,
        mes_correspondiente: 10,
        anio_aplicacion: 2026,
        mes_aplicacion: 11,
        importe_centimos: 5000,
        estado: 'pendiente',
      },
    ],
    cierre_mensual: [{ anio: 2026, mes: 10 }],
    beca_comedor_elegibilidad: [{ nino_id: 'n1' }],
    ninos: [{ id: 'n1', nombre: 'Niño', apellidos: 'Demo', familia_id: 'f1' }],
    recibos: [{ familia_id: 'f1', anio: 2026, mes: 10 }],
    beca_comedor_transferencia: [
      {
        id: 't1',
        familia_id: 'f1',
        importe_centimos: 1000,
        anio: 2026,
        mes: 10,
        estado: 'pendiente',
        realizada_at: null,
        origen: 'beca',
      },
    ],
    familias: [{ id: 'f1', etiqueta: 'Familia Demo' }],
  }
})

describe('getCargasBeca', () => {
  it('premisa: con todo leído, la carga, el mes cerrado, el nombre y el recibo validado', async () => {
    const r = await getCargasBeca('c1')
    expect(r.cargas).toHaveLength(1)
    expect(r.mesesCerrados).toEqual([{ anio: 2026, mes: 10 }])
    expect(r.nombres).toEqual({ n1: 'Niño Demo' })
    expect(r.recibosValidados).toEqual(['n1:2026-10'])
  })

  it.each([
    ['beca_comedor_tramo', 'cargas de beca: tramos'],
    ['cierre_mensual', 'cargas de beca: cierres'],
    ['beca_comedor_elegibilidad', 'cargas de beca: becados'],
    ['ninos', 'cargas de beca: nombres'],
    ['recibos', 'cargas de beca: recibos validados'],
  ])('con %s caída: lanza en «%s»', async (tabla, donde) => {
    estado.falla = tabla
    await lanzaEn(getCargasBeca('c1'), donde)
  })
})

describe('getTransferenciasBeca', () => {
  it('premisa: con todo leído, la pendiente sale con su familia', async () => {
    const r = await getTransferenciasBeca('c1')
    expect(r.pendientes).toEqual([
      expect.objectContaining({ id: 't1', familiaEtiqueta: 'Familia Demo' }),
    ])
  })

  it.each([
    ['beca_comedor_transferencia', 'transferencias de beca'],
    ['familias', 'transferencias de beca: familias'],
  ])('con %s caída: no dice «no hay», lanza en «%s»', async (tabla, donde) => {
    estado.falla = tabla
    await lanzaEn(getTransferenciasBeca('c1'), donde)
  })
})
