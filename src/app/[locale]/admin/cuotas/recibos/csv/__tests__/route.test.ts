// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El CSV de los recibos del mes con la tabla sin leer (censo C, B1, 2026-11-26): `getPivotePeriodo` daba
 * la tabla vacía y salía un CSV sin recibos, un documento de cuentas falso. Ahora lanza, y la ruta contesta
 * 500 en vez de entregar ese CSV.
 */
const { bd } = vi.hoisted(() => ({ bd: { falla: false } }))

vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))
vi.mock('@/features/centros/contexto/get-contexto-centro', () => ({
  getEstadoCentro: async () => ({ tipo: 'activo', contexto: { centroId: 'centro-1' } }),
}))
vi.mock('@/features/recibos/queries/get-pivote-periodo', async () => {
  const { LecturaFallida: L } = await import('@/shared/lib/lectura-fallida')
  return {
    getPivotePeriodo: async () => {
      if (bd.falla) throw new L('getPivotePeriodo', { code: 'XX000', message: 'caída' })
      return { filas: [], totales: {} }
    },
  }
})
vi.mock('@/features/recibos/lib/pivote-csv', () => ({ pivoteACsvFilas: () => [['a']] }))

const { GET } = await import('../route')
const pedir = () =>
  GET(new Request('http://x/es/admin/cuotas/recibos/csv?anio=2026&mes=11'), {
    params: Promise.resolve({ locale: 'es' }),
  })

beforeEach(() => {
  bd.falla = false
})

describe('GET /admin/cuotas/recibos/csv', () => {
  it('premisa: con la tabla leída, sale el CSV', async () => {
    const res = await pedir()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/csv')
  })

  it('con la tabla sin leer: 500, no un CSV sin recibos', async () => {
    bd.falla = true
    const res = await pedir()
    expect(res.status).toBe(500)
    expect(res.headers.get('Content-Type') ?? '').not.toContain('text/csv')
  })
})
