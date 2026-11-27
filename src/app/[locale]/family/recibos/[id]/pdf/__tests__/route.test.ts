// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El PDF del recibo de la familia con una lectura caída (censo C, B1, 2026-11-26): salía con el total y sin
 * líneas, o sin el nombre del centro. Ahora la consulta lanza y la ruta contesta 500: no se entrega.
 */
const { bd } = vi.hoisted(() => ({ bd: { falla: false, generados: 0 } }))

vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))
vi.mock('@/features/centros/contexto/get-contexto-centro', () => ({
  getEstadoCentro: async () => ({ tipo: 'activo', contexto: { centroId: 'centro-1' } }),
}))
vi.mock('@/features/centros/contexto/ambito-familiar', () => ({
  ambitoFamiliar: async () => ({ centroId: 'centro-1', hijos: [] }),
}))
vi.mock('@/features/recibos/lib/recibo-pdf', () => ({
  generarReciboPdf: async () => {
    bd.generados++
    return new Uint8Array([1])
  },
}))
vi.mock('@/features/recibos/queries/get-recibo-pdf-data', async () => {
  const { LecturaFallida: L } = await import('@/shared/lib/lectura-fallida')
  return {
    getReciboParaPdf: async () => {
      if (bd.falla) throw new L('getReciboParaPdf: líneas', { code: 'XX000', message: 'caída' })
      return {
        anio: 2026,
        mes: 11,
        estado: 'pendiente_procesar',
        metodo: null,
        totalCentimos: 1000,
        esEsporadico: false,
        conceptoEsporadico: null,
        fechaEnvioBanco: null,
        fechaDevolucion: null,
        centroNombre: 'CEI Ejemplo',
        centroLogoUrl: null,
        gruposHijo: [],
        lineasFamiliares: [],
        subtotalFamiliarCentimos: 0,
      }
    },
  }
})

const { GET } = await import('../route')
const pedir = () =>
  GET(new Request('http://x/es/family/recibos/r-1/pdf'), {
    params: Promise.resolve({ locale: 'es', id: 'r-1' }),
  })

beforeEach(() => {
  bd.falla = false
  bd.generados = 0
})

describe('GET /family/recibos/[id]/pdf', () => {
  it('premisa: con el recibo leído, compone el PDF', async () => {
    const res = await pedir()
    expect(res.status).toBe(200)
    expect(bd.generados).toBe(1)
  })

  it('con una lectura caída: 500, y no compone ningún PDF', async () => {
    bd.falla = true
    const res = await pedir()
    expect(res.status).toBe(500)
    expect(bd.generados).toBe(0)
  })
})
