import { beforeEach, describe, expect, it, vi } from 'vitest'

import { esLecturaFallida } from '@/shared/lib/lectura-fallida'

/**
 * Censo C (B1, lista blanca, 2026-11-26): el último lote, helpers compartidos y consultas con una lectura
 * caída. Antes: `ambitoFamiliar` «no tienes hijos en este centro»; `familiaDelUsuarioEn` «no eres de
 * ninguna familia»; `getCursoActivo` «el centro no tiene curso activo»; `getNinosDeFamilia` el aula vacía
 * para toda la familia; `countNoLeidos` conversaciones y anuncios sin leer a 0; `getLectoresAnuncio`
 * «nadie lo ha leído». Ahora lanzan `LecturaFallida`. Cada bloque con su premisa. Fixtures ficticios.
 */
const { estado } = vi.hoisted(() => ({
  estado: { falla: null as string | null, filas: {} as Record<string, unknown> },
}))

vi.mock('@/features/centros/contexto/roles-del-usuario', () => ({
  rolesEnCentro: async () => ({ rol: 'tutor_legal' }),
}))
vi.mock('@/features/messaging/queries/audiencia-anuncio', () => ({
  audienciaAnuncio: async () => new Set(['u-2']),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    from: (tabla: string) => {
      const responder = (una: boolean) => {
        if (estado.falla === tabla)
          return { data: null, error: { code: 'XX000', message: 'caída' } }
        const v = estado.filas[tabla] ?? []
        if (una) return { data: Array.isArray(v) ? (v[0] ?? null) : v, error: null }
        return { data: Array.isArray(v) ? v : [v], error: null }
      }
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'in', 'neq', 'order', 'limit']) c[m] = () => c
      c.maybeSingle = async () => responder(true)
      c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(responder(false)).then(res, rej)
      return c
    },
  }),
}))

const { ambitoFamiliar, familiaDelUsuarioEn } =
  await import('@/features/centros/contexto/ambito-familiar')
const { getCursoActivo } = await import('@/features/cursos/queries/get-cursos')
const { getNinosDeFamilia } = await import('@/features/familias/queries/get-ninos-de-familia')
const { countNoLeidos } = await import('@/features/messaging/queries/count-no-leidos')
const { getLectoresAnuncio } = await import('@/features/messaging/queries/get-lectores-anuncio')

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
    vinculos_familiares: [
      {
        tipo_vinculo: 'tutor_legal_principal',
        nino: { id: 'n-1', nombre: 'Niño', apellidos: 'Demo', centro_id: 'c-1' },
      },
    ],
    familia_tutores: { familia_id: 'f-1' },
    cursos_academicos: { id: 'curso-1', nombre: '26-27', estado: 'activo' },
    ninos: [{ id: 'n-1', nombre: 'Niño', apellidos: 'Demo', deleted_at: null }],
    matriculas: [{ nino_id: 'n-1', aulas_curso: { aulas: { nombre: 'Aula Demo' } } }],
    conversaciones: [],
    anuncios: { id: 'an-1', centro_id: 'c-1', ambito: 'centro', aula_id: null, autor_id: 'u-1' },
    lectura_anuncio: [{ usuario_id: 'u-2', leido_at: '2026-11-26T10:00:00Z' }],
    usuarios: [{ id: 'u-2', nombre_completo: 'Tutora Demo' }],
  }
})

describe('helpers compartidos', () => {
  it('premisa: con todo leído, el hijo, la familia y el curso activo', async () => {
    expect((await ambitoFamiliar('c-1')).hijos).toHaveLength(1)
    expect(await familiaDelUsuarioEn('c-1')).toEqual({ familiaId: 'f-1', centroId: 'c-1' })
    expect((await getCursoActivo('c-1'))?.id).toBe('curso-1')
  })

  it('ambitoFamiliar sin leer los vínculos: lanza, no «sin hijos»', async () => {
    estado.falla = 'vinculos_familiares'
    await lanzaEn(ambitoFamiliar('c-otro'), 'ambitoFamiliar')
  })

  it('familiaDelUsuarioEn sin leer: lanza, no «no eres de ninguna familia»', async () => {
    estado.falla = 'familia_tutores'
    await lanzaEn(familiaDelUsuarioEn('c-1'), 'familiaDelUsuarioEn')
  })

  it('getCursoActivo sin leer: lanza, no «sin curso activo»', async () => {
    estado.falla = 'cursos_academicos'
    await lanzaEn(getCursoActivo('c-1'), 'getCursoActivo')
  })
})

describe('consultas de familias y mensajería', () => {
  it('premisa: el aula del hijo, el anuncio sin leer y quién lo ha leído', async () => {
    expect((await getNinosDeFamilia('f-1'))[0]?.aula_nombre).toBe('Aula Demo')
    expect((await getLectoresAnuncio('an-1'))[0]?.leido_en).toBe('2026-11-26T10:00:00Z')
  })

  it.each([
    ['matriculas', () => getNinosDeFamilia('f-1'), 'getNinosDeFamilia: matrículas'],
    ['conversaciones', () => countNoLeidos('c-1'), 'countNoLeidos: conversaciones'],
    ['anuncios', () => countNoLeidos('c-1'), 'countNoLeidos: anuncios'],
    ['lectura_anuncio', () => getLectoresAnuncio('an-1'), 'getLectoresAnuncio: lecturas'],
  ] as const)('con %s caída: lanza, con su donde', async (tabla, llamar, donde) => {
    estado.falla = tabla
    await lanzaEn(llamar(), donde)
  })
})
