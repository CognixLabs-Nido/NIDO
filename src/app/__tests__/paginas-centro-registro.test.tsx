import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Multicentro · Fase 1 · PR3 — decisión de Jose: las páginas de un aula sacan el rol del CENTRO DEL
 * AULA, no del centro activo, y se muestran aunque el aula sea de otro centro (la cabecera lo
 * avisa). Usuario profe en B con A activo: entra en un aula de B; con rol solo en A, no.
 *
 * Y el CSV de recibos lee el centro activo sin redirigir: sin centro activo, 403.
 */

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'

const m = vi.hoisted(() => ({
  contextoEnCentro: vi.fn(),
  getEstadoCentro: vi.fn(),
  getPivotePeriodo: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`)
  }),
}))

vi.mock('@/features/centros/contexto/get-contexto-centro', () => ({
  contextoEnCentro: m.contextoEnCentro,
  getEstadoCentro: m.getEstadoCentro,
}))
vi.mock('next/navigation', () => ({ redirect: m.redirect, notFound: vi.fn() }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))
vi.mock('@/features/aulas/queries/get-aulas', () => ({
  getAulaById: async () => ({ id: 'aula-1', nombre: 'Aula Demo', centro_id: B }),
}))
vi.mock('@/features/centros/components/AvisoCentroDistinto', () => ({
  AvisoCentroDistinto: () => null,
}))
vi.mock('@/features/parte-servicio/queries/get-parte-servicio-aula', () => ({
  getParteServicioAula: async () => [],
}))
vi.mock('@/features/parte-servicio/components/PaseDeListaServicioCliente', () => ({
  PaseDeListaServicioCliente: () => null,
}))
vi.mock('@/features/menus/queries/get-pase-de-lista-comida-todos-momentos', () => ({
  getPaseDeListaComidaTodosMomentos: async () => ({}),
}))
vi.mock('@/features/menus/components/PaseDeListaComidaCliente', () => ({
  PaseDeListaComidaCliente: () => null,
}))
vi.mock('@/features/recibos/queries/get-pivote-periodo', () => ({
  getPivotePeriodo: m.getPivotePeriodo,
}))
vi.mock('@/features/recibos/lib/pivote-csv', () => ({ pivoteACsvFilas: () => [] }))
vi.mock('@/shared/lib/export-csv', () => ({ generarCsv: () => '' }))

/** Rol del usuario por centro: profe en B (el del aula); en A, lo que diga el caso. */
function rolesPorCentro(roles: Record<string, string | undefined>) {
  m.contextoEnCentro.mockImplementation(async (centroId: string) =>
    roles[centroId] ? { centroId, rol: roles[centroId] } : null
  )
}

const params = Promise.resolve({ locale: 'es', id: 'aula-1' })
const searchParams = Promise.resolve({})

beforeEach(() => vi.clearAllMocks())

describe.each([
  ['servicio', () => import('../[locale]/teacher/aula/[id]/servicio/page')],
  ['comida', () => import('../[locale]/teacher/aula/[id]/comida/page')],
])('teacher/aula/[id]/%s — rol en el centro del aula', (_nombre, cargar) => {
  it('profe en B (centro del aula), con A activo → entra', async () => {
    rolesPorCentro({ [A]: 'admin', [B]: 'profe' })
    const { default: Page } = await cargar()
    await expect(Page({ params, searchParams })).resolves.toBeTruthy()
    expect(m.contextoEnCentro).toHaveBeenCalledWith(B)
    expect(m.redirect).not.toHaveBeenCalled()
  })

  it('admin solo en A (no en el centro del aula) → forbidden', async () => {
    rolesPorCentro({ [A]: 'admin' })
    const { default: Page } = await cargar()
    await expect(Page({ params, searchParams })).rejects.toThrow('REDIRECT /es/forbidden')
  })
})

describe('admin/cuotas/recibos/csv — centro activo sin redirigir', () => {
  const req = () => new Request('http://x/es/admin/cuotas/recibos/csv?anio=2026&mes=3')
  const ctx = { params: Promise.resolve({ locale: 'es' }) }

  it('varios centros sin elegir → 403, sin redirigir ni leer recibos', async () => {
    m.getEstadoCentro.mockResolvedValue({ tipo: 'elegir', centros: [] })
    const { GET } = await import('../[locale]/admin/cuotas/recibos/csv/route')
    const res = await GET(req(), ctx)
    expect(res.status).toBe(403)
    expect(m.redirect).not.toHaveBeenCalled()
    expect(m.getPivotePeriodo).not.toHaveBeenCalled()
  })

  it('con centro activo → la pivote de ESE centro', async () => {
    m.getEstadoCentro.mockResolvedValue({ tipo: 'activo', contexto: { centroId: B } })
    m.getPivotePeriodo.mockResolvedValue({})
    const { GET } = await import('../[locale]/admin/cuotas/recibos/csv/route')
    const res = await GET(req(), ctx)
    expect(res.status).toBe(200)
    expect(m.getPivotePeriodo).toHaveBeenCalledWith(B, 2026, 3)
  })
})
