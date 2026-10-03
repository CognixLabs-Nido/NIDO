import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  it.each([
    ['no admin (false)', { data: false, error: null }],
    ['error del rpc', { data: null, error: { message: 'boom' } }],
  ])('%s → null, sin leer nada más ni firmar', async (_caso, respuesta) => {
    rpc.mockResolvedValue(respuesta)
    tablas({ ninos: [{ data: { nombre: 'Ana', apellidos: null }, error: null }] })
    const r = await getFotosPendientesNino(NINO, CENTRO)
    expect(r).toBeNull()
    expect(rpc).toHaveBeenCalledWith('es_admin', { p_centro_id: CENTRO })
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
