import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Censo C (B1, lista blanca, 2026-11-26): crear un informe y publicar en lote, con una lectura caída.
 *  - crear: «¿ya existe el de la terna?» caído era «no» → insert, que paraba el UNIQUE con un «no se pudo»
 *    genérico. Y tras el 23505, sin poder releerlo, «no se pudo crear» de un informe que existe: ahora dice
 *    que existe y que se recargue (`ya_existe_recarga`).
 *  - publicar en lote: sin la campaña o el aula, «no se pudo publicar»; sin los niños (lectura que la
 *    regla de lint no ve: va por `aplicarMatriculaActiva`), «0 informes» y ok.
 * Cada bloque empieza por su premisa. Fixtures ficticios.
 */
const { estado } = vi.hoisted(() => ({
  estado: {
    vistas: {} as Record<string, number>,
    falla: null as { tabla: string; n: number } | null,
    filas: {} as Record<string, unknown[]>,
    insertError: null as unknown,
    escrituras: [] as string[],
  },
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/features/cursos/queries/get-cursos', () => ({
  getCursoActivo: async () => ({ id: 'curso-1' }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    from: (tabla: string) => {
      let op = 'select'
      const responder = (una: boolean) => {
        if (op === 'insert') {
          estado.escrituras.push(`insert ${tabla}`)
          return estado.insertError
            ? { data: null, error: estado.insertError }
            : { data: { id: 'inf-nuevo' }, error: null }
        }
        const n = (estado.vistas[tabla] = (estado.vistas[tabla] ?? 0) + 1)
        if (estado.falla?.tabla === tabla && estado.falla.n === n)
          return { data: null, error: { code: 'XX000', message: 'caída' } }
        const lista = estado.filas[tabla] ?? [null]
        const v = lista[Math.min(n, lista.length) - 1]
        if (una) return { data: Array.isArray(v) ? (v[0] ?? null) : v, error: null }
        return { data: v === null ? [] : Array.isArray(v) ? v : [v], error: null }
      }
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'in']) c[m] = () => c
      c.insert = () => ((op = 'insert'), c)
      c.maybeSingle = async () => responder(true)
      c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(responder(false)).then(res, rej)
      return c
    },
  }),
}))

const { crearInformeEvolucion } = await import('../gestionar-informe')
const { publicarLoteInformes } = await import('../publicar-lote-informes')

const NINO = '00000000-0000-4000-8000-000000000001'
const PLANTILLA = '00000000-0000-4000-8000-000000000002'
const CAMPANA = '00000000-0000-4000-8000-000000000003'
const AULA = '00000000-0000-4000-8000-000000000004'
const LECTURA_FALLIDA = { success: false, error: 'common.lectura_fallida' }

beforeEach(() => {
  estado.vistas = {}
  estado.falla = null
  estado.insertError = null
  estado.escrituras = []
  estado.filas = {
    ninos: [{ centro_id: 'c-1' }],
    // Lecturas de informes_evolucion: 1.ª «¿ya existe?» (no); 2.ª, la relectura tras un 23505 (sí).
    informes_evolucion: [null, { id: 'inf-otro' }],
    plantillas_informe: [{ id: PLANTILLA, estructura: {}, estado: 'activa', centro_id: 'c-1' }],
    campanas_informe: [
      {
        curso_academico_id: 'curso-1',
        periodo: 'trimestre_1',
        estado: 'abierta',
        centro_id: 'c-1',
      },
    ],
    aulas: [{ id: AULA }],
    matriculas: [[]],
  }
})

describe('crearInformeEvolucion', () => {
  const crear = () =>
    crearInformeEvolucion({ nino_id: NINO, periodo: 'trimestre_1', plantilla_id: PLANTILLA })

  it('premisa: sin informe de la terna, lo crea', async () => {
    expect(await crear()).toEqual({ success: true, data: { informe_id: 'inf-nuevo' } })
  })

  it('sin poder mirar si ya existe: lo dice, y no inserta', async () => {
    estado.falla = { tabla: 'informes_evolucion', n: 1 }
    expect(await crear()).toEqual(LECTURA_FALLIDA)
    expect(estado.escrituras).toEqual([])
  })

  it('premisa del 23505: otro lo creó a la vez y se relee, devuelve el suyo', async () => {
    estado.insertError = { code: '23505', message: 'dup' }
    expect(await crear()).toEqual({ success: true, data: { informe_id: 'inf-otro' } })
  })

  it('23505 y sin poder releerlo: «ya existe, recarga», no «no se pudo crear»', async () => {
    estado.insertError = { code: '23505', message: 'dup' }
    estado.falla = { tabla: 'informes_evolucion', n: 2 }
    expect(await crear()).toEqual({ success: false, error: 'informes.errors.ya_existe_recarga' })
  })
})

describe('publicarLoteInformes', () => {
  it('premisa: con todo leído y sin niños en el aula, 0 y ok, tras leer las matrículas', async () => {
    expect(await publicarLoteInformes({ campana_id: CAMPANA, aula_id: AULA })).toEqual({
      success: true,
      data: { total: 0, publicados: 0, incompletos: 0, fallidos: 0 },
    })
    expect(estado.vistas.matriculas, 'premisa: leyó las matrículas').toBe(1)
  })

  it.each(['campanas_informe', 'aulas', 'matriculas'])(
    'con %s caída: no dice «0 informes» ni «no se pudo publicar»',
    async (tabla) => {
      estado.falla = { tabla, n: 1 }
      expect(await publicarLoteInformes({ campana_id: CAMPANA, aula_id: AULA })).toEqual(
        LECTURA_FALLIDA
      )
    }
  )
})
