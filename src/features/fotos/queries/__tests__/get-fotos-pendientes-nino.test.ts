import { beforeEach, describe, expect, it, vi } from 'vitest'

import { esLecturaFallida } from '@/shared/lib/lectura-fallida'

/**
 * D3 — `getFotosPendientesNino` autoriza en la propia query (`es_admin` del centro), no solo
 * en el layout de admin. Si quien llama no es admin del centro: `null`, sin leer el niño ni
 * sus etiquetas y sin firmar nada con service role.
 */

const rpc = vi.fn()
const from = vi.fn()
const createServiceRoleClient = vi.fn()

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc, from }) }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient }))

const { getFotosPendientesNino } = await import('../get-fotos-pendientes-nino')

const NINO = 'n1'
const CENTRO = 'c1'

/** Builder con cola de respuestas por tabla (cada await consume la siguiente). */
function tablas(resp: Record<string, unknown[]>) {
  from.mockImplementation((tabla: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {}
    for (const m of ['select', 'eq', 'is', 'in', 'maybeSingle']) b[m] = () => b
    b.then = (resolve: (v: unknown) => unknown) => resolve(resp[tabla]?.shift())
    return b
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('D3 — getFotosPendientesNino', () => {
  it('no admin (false) → null, sin leer nada más ni firmar', async () => {
    rpc.mockResolvedValue({ data: false, error: null })
    tablas({ ninos: [{ data: { nombre: 'Ana', apellidos: null }, error: null }] })
    const r = await getFotosPendientesNino(NINO, CENTRO)
    expect(r).toBeNull()
    expect(rpc).toHaveBeenCalledWith('es_admin', { p_centro_id: CENTRO })
    expect(from).not.toHaveBeenCalled()
    expect(createServiceRoleClient).not.toHaveBeenCalled()
  })

  // Censo C (B1, 2026-11-26): el error del rpc daba `null` como «no eres Dirección». Ahora lanza
  // `LecturaFallida` (la página la pinta con su error.tsx), igual sin leer nada más ni firmar.
  it('error del rpc → LecturaFallida, sin leer nada más ni firmar', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    tablas({ ninos: [{ data: { nombre: 'Ana', apellidos: null }, error: null }] })
    const e = await getFotosPendientesNino(NINO, CENTRO).then(
      () => null,
      (err: unknown) => err
    )
    expect(esLecturaFallida(e)).toBe(true)
    expect(from).not.toHaveBeenCalled()
    expect(createServiceRoleClient).not.toHaveBeenCalled()
  })

  it('admin del centro → ve las fotos pendientes del niño', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    tablas({
      ninos: [{ data: { nombre: 'Ana', apellidos: 'Pérez' }, error: null }],
      media_etiquetas: [
        {
          data: [
            {
              id: 'e1',
              media_id: 'm1',
              media: { id: 'm1', path_miniatura: 'p/t.jpg', publicacion_id: 'pub1' },
            },
          ],
          error: null,
        },
        { data: [{ media_id: 'm1', nino_id: NINO }], error: null },
      ],
      media: [{ data: [{ id: 'm1', publicacion_id: 'pub1' }], error: null }],
    })
    createServiceRoleClient.mockReturnValue({
      storage: {
        from: () => ({
          createSignedUrls: async () => ({
            data: [{ path: 'p/t.jpg', signedUrl: 'https://firmada' }],
          }),
        }),
      },
    })
    const r = await getFotosPendientesNino(NINO, CENTRO)
    expect(r).toEqual({
      nombre: 'Ana',
      apellidos: 'Pérez',
      fotos: [
        {
          etiquetaId: 'e1',
          mediaId: 'm1',
          publicacionId: 'pub1',
          urlMiniatura: 'https://firmada',
          ninosEnPublicacion: 1,
        },
      ],
    })
  })
})

/**
 * Censo C (B1, 2026-11-26): con una de las lecturas que cuentan los niños de la publicación caída,
 * `ninosEnPublicacion` caía a 1 («solo sale este niño»): el aviso que Dirección lee antes de borrar la
 * publicación callaba que salen otros. Ahora lanza. Premisa: una publicación con dos niños dice 2.
 */
describe('censo C: el aviso de cuántos niños salen', () => {
  const CAIDA = { data: null, error: { code: 'XX000', message: 'caída' } }
  const ETIQUETA = {
    id: 'e1',
    media_id: 'm1',
    media: { id: 'm1', path_miniatura: null, publicacion_id: 'pub1' },
  }
  function montar(caida: string | null) {
    rpc.mockResolvedValue({ data: true, error: null })
    tablas({
      ninos: [
        caida === 'ninos' ? CAIDA : { data: { nombre: 'Ana', apellidos: null }, error: null },
      ],
      media_etiquetas: [
        caida === 'etiquetas' ? CAIDA : { data: [ETIQUETA], error: null },
        caida === 'todas'
          ? CAIDA
          : {
              data: [
                { media_id: 'm1', nino_id: NINO },
                { media_id: 'm1', nino_id: 'otro' },
              ],
              error: null,
            },
      ],
      media: [
        caida === 'media' ? CAIDA : { data: [{ id: 'm1', publicacion_id: 'pub1' }], error: null },
      ],
    })
  }

  it('premisa: con todo leído, la publicación con dos niños dice 2', async () => {
    montar(null)
    const r = await getFotosPendientesNino(NINO, CENTRO)
    expect(r?.fotos[0]?.ninosEnPublicacion).toBe(2)
  })

  it.each(['ninos', 'etiquetas', 'media', 'todas'])(
    'con %s caída: no dice 1, lanza',
    async (caida) => {
      montar(caida)
      const e = await getFotosPendientesNino(NINO, CENTRO).then(
        () => null,
        (err: unknown) => err
      )
      expect(esLecturaFallida(e), `esperaba una LecturaFallida, llegó ${String(e)}`).toBe(true)
    }
  )
})
