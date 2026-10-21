import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ContextoCentro } from '@/features/centros/contexto/get-contexto-centro'

/**
 * Multicentro · Fase 1 · PR2: las páginas sacan centro y rol de `requireContextoCentro`. Una por
 * forma del codemod:
 * - forma B (centro → rol): el rol que manda es el del CENTRO ACTIVO, no el más alto en cualquier
 *   centro. Un usuario admin en A y tutor_legal en B, con B activo, no entra en la vista de profe;
 * - forma A, con el `locale` añadido a mano: la página pide el contexto con su idioma y consulta
 *   con el centro activo.
 */

const { requireContextoCentro, redirect, getCursosPorCentro } = vi.hoisted(() => ({
  requireContextoCentro: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`)
  }),
  getCursosPorCentro: vi.fn(),
}))

vi.mock('@/features/centros/contexto/get-contexto-centro', () => ({ requireContextoCentro }))
vi.mock('next/navigation', () => ({ redirect, notFound: vi.fn() }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))
vi.mock('@/features/autorizaciones/components/AutorizacionDetalleView', () => ({
  AutorizacionDetalleView: () => null,
}))
vi.mock('@/features/cursos/queries/get-cursos', () => ({ getCursosPorCentro }))
vi.mock('@/features/cursos/components/ActivarCursoButton', () => ({
  ActivarCursoButton: () => null,
}))
vi.mock('@/features/cursos/components/NuevoCursoDialog', () => ({ NuevoCursoDialog: () => null }))

const CENTRO_A = '00000000-0000-4000-8000-00000000000a'
const CENTRO_B = '00000000-0000-4000-8000-00000000000b'

function contexto(centroId: string, rol: ContextoCentro['rol']): ContextoCentro {
  return {
    centroId,
    rol,
    roles: [rol],
    esResponsable: rol === 'admin',
    esSuperusuario: false,
    centros: [
      { centroId: CENTRO_A, rol: 'admin', roles: ['admin'], esResponsable: true },
      { centroId: CENTRO_B, rol: 'tutor_legal', roles: ['tutor_legal'], esResponsable: false },
    ],
  }
}

describe('forma B · teacher/autorizaciones/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  async function abrir() {
    const { default: Page } = await import('../[locale]/teacher/autorizaciones/[id]/page')
    return Page({ params: Promise.resolve({ locale: 'es', id: 'aut-1' }) })
  }

  it('con A activo (admin) entra', async () => {
    requireContextoCentro.mockResolvedValue(contexto(CENTRO_A, 'admin'))
    await expect(abrir()).resolves.toBeTruthy()
    expect(requireContextoCentro).toHaveBeenCalledWith('es')
    expect(redirect).not.toHaveBeenCalled()
  })

  it('con B activo (tutor_legal) → forbidden, aunque sea admin en A', async () => {
    requireContextoCentro.mockResolvedValue(contexto(CENTRO_B, 'tutor_legal'))
    // Premisa: el usuario SÍ es admin en otro centro; lo que se mide es que no cuenta.
    expect(contexto(CENTRO_B, 'tutor_legal').centros.some((c) => c.rol === 'admin')).toBe(true)
    await expect(abrir()).rejects.toThrow('REDIRECT /es/forbidden')
  })
})

describe('forma A con locale añadido · admin/cursos', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pide el contexto con su idioma y consulta los cursos del centro activo', async () => {
    requireContextoCentro.mockResolvedValue(contexto(CENTRO_B, 'admin'))
    getCursosPorCentro.mockResolvedValue([])
    const { default: Page } = await import('../[locale]/admin/cursos/page')
    await Page({ params: Promise.resolve({ locale: 'va' }) })
    expect(requireContextoCentro).toHaveBeenCalledWith('va')
    expect(getCursosPorCentro).toHaveBeenCalledWith(CENTRO_B)
  })
})
