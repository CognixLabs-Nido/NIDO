import { beforeEach, describe, expect, it, vi } from 'vitest'

import { esLecturaFallida } from '@/shared/lib/lectura-fallida'

/**
 * Censo C (B1, lista blanca, 2026-11-26): los avisos de la página de inicio con una lectura caída. Antes,
 * cada contador caído era un 0 («nada pendiente de confirmar», «ninguna medicación por archivar», «sin
 * recibos nuevos») y las domiciliaciones nuevas, ninguna. Ahora lanza `LecturaFallida`, como las otras
 * lecturas de esas páginas, y la pinta su `error.tsx`. Cada bloque empieza por su premisa: con todo leído,
 * el contador sale distinto de 0, así que un 0 no puede pasar por «leído». Fixtures ficticios.
 */
const { estado } = vi.hoisted(() => ({
  estado: {
    // Por tabla: una lista de respuestas (se consumen en orden; la última se repite).
    filas: {} as Record<string, unknown[]>,
    vistas: {} as Record<string, number>,
    falla: null as { tabla: string; n: number } | null,
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    from: (tabla: string) => {
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'in', 'neq', 'not', 'gte', 'lt']) c[m] = () => c
      c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        const n = (estado.vistas[tabla] = (estado.vistas[tabla] ?? 0) + 1)
        const lista = estado.filas[tabla] ?? [[]]
        const v = lista[Math.min(n, lista.length) - 1]
        const r =
          estado.falla?.tabla === tabla && estado.falla.n === n
            ? { data: null, count: null, error: { code: 'XX000', message: 'caída' } }
            : { data: v, count: Array.isArray(v) ? v.length : 0, error: null }
        return Promise.resolve(r).then(res, rej)
      }
      return c
    },
  }),
}))
vi.mock('@/features/autorizaciones/queries/get-autorizaciones-familia', () => ({
  getAutorizacionesFamilia: async () => [],
}))
vi.mock('@/features/centros/contexto/ambito-familiar', () => ({
  ambitoFamiliar: async (centroId: string) => ({ centroId, hijos: [] }),
}))
vi.mock('@/features/informes/queries/get-pendientes-campana-profe', () => ({
  getPendientesCampanaProfe: async () => null,
}))
vi.mock('../../lib/helpers', async (orig) => ({
  ...(await orig<typeof import('../../lib/helpers')>()),
  getDomiciliacionesVistas: async () => ({}),
  getFirmasVistas: async () => ({}),
  getFotosVistas: async () => ({}),
  getInformesVistos: async () => ({}),
  getRecibosVistos: async () => ({}),
}))

const { getAvisosInicio } = await import('../get-avisos-inicio')

async function lanzaEn(p: Promise<unknown>, donde: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err
  )
  expect(esLecturaFallida(e), `esperaba una LecturaFallida, llegó ${String(e)}`).toBe(true)
  expect((e as { donde: string }).donde).toBe(donde)
}

const RECIENTE = new Date().toISOString()
const FIRMA = { autorizacion_id: 'a-1', created_at: RECIENTE }

beforeEach(() => {
  estado.falla = null
  estado.vistas = {}
  estado.filas = {
    // Lecturas de `autorizaciones` en orden: medicaciones activas, y (staff) por archivar.
    autorizaciones: [[{ id: 'm-1' }], [{ id: 'm-2' }]],
    // De `administraciones_medicacion`: pendientes de confirmar, confirmadas.
    administraciones_medicacion: [[{ id: 'x-1' }], [{ id: 'x-2' }]],
    // De `firmas_autorizacion`: firmas nuevas, revocaciones.
    firmas_autorizacion: [[FIRMA], [FIRMA]],
    mandatos_sepa: [[{ familia_id: 'f-1', created_at: RECIENTE }]],
    ninos: [[{ familia_id: 'f-1', matriculas: [{ activada_at: '2026-01-01T00:00:00Z' }] }]],
    informes_evolucion: [[{ id: 'i-1' }]],
    publicaciones: [[{ id: 'p-1' }]],
    recibos: [[{ id: 'r-1' }]],
  }
})

describe('avisos de Dirección y de la profe', () => {
  it('premisa: con todo leído, cada contador sale distinto de 0 y la domiciliación nueva, también', async () => {
    const a = await getAvisosInicio('admin', 'c-1')
    expect(a).toMatchObject({
      medicacionesActivas: 1,
      pendientesConfirmar: 1,
      confirmadas: 1,
      nuevasFirmas: 1,
      revocaciones: 1,
      medicacionesPorArchivar: 1,
      familiasDomiciliacionNueva: ['f-1'],
    })
  })

  it.each([
    ['autorizaciones', 1, 'avisos: medicaciones activas'],
    ['administraciones_medicacion', 1, 'avisos: pendientes de confirmar'],
    ['administraciones_medicacion', 2, 'avisos: confirmadas'],
    ['firmas_autorizacion', 1, 'avisos: firmas nuevas'],
    ['firmas_autorizacion', 2, 'avisos: revocaciones'],
    ['autorizaciones', 2, 'avisos: medicaciones por archivar'],
    ['mandatos_sepa', 1, 'avisos: domiciliaciones'],
    ['ninos', 1, 'avisos: domiciliaciones (niños)'],
  ] as const)(
    'con la lectura %s n.º %s caída: no dice 0, lanza en «%s»',
    async (tabla, n, donde) => {
      estado.falla = { tabla, n }
      await lanzaEn(getAvisosInicio('admin', 'c-1'), donde)
    }
  )
})

describe('avisos de la familia', () => {
  it('premisa: con todo leído, informes, fotos y recibos nuevos salen distintos de 0', async () => {
    expect(await getAvisosInicio('tutor_legal', 'c-1')).toMatchObject({
      informesNuevos: 1,
      fotosNuevas: 1,
      recibosNuevos: 1,
    })
  })

  it.each([
    ['informes_evolucion', 'avisos: informes'],
    ['publicaciones', 'avisos: fotos'],
    ['recibos', 'avisos: recibos'],
  ] as const)('con %s caída: no dice «nada nuevo», lanza en «%s»', async (tabla, donde) => {
    estado.falla = { tabla, n: 1 }
    await lanzaEn(getAvisosInicio('tutor_legal', 'c-1'), donde)
  })
})
