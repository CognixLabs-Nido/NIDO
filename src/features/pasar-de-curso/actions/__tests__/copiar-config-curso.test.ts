import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `copiarConfigCurso` copia el personal del curso activo al planificado sin tocar la
 * columna `es_profe_principal`, que se borra en 20261008120000. Si la consulta la
 * siguiera pidiendo, PostgREST devolvería error y «pasar de curso» con personal fallaría.
 * Se registran el select y el insert de `profes_aulas` para comprobarlo.
 */

const DESTINO = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
const ORIGEN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
const CENTRO = 'ffffffff-ffff-4fff-8fff-fffffffffff1'
const AULA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const PROFE_A = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
const PROFE_B = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'

interface Registro {
  selects: { tabla: string; columnas: string }[]
  inserts: { tabla: string; filas: unknown }[]
}

const registro: Registro = { selects: [], inserts: [] }
let selectsPorTabla: Record<string, number> = {}

// Respuesta por (tabla, n.º de select en esa tabla).
function respuesta(tabla: string, n: number): { data: unknown; error: unknown } {
  if (tabla === 'cursos_academicos') {
    return { data: { id: DESTINO, centro_id: CENTRO, estado: 'planificado' }, error: null }
  }
  if (tabla === 'aulas_curso') return { data: [], error: null }
  if (tabla === 'profes_aulas' && n === 0) {
    // Origen: dos asignaciones activas, una coordinadora y una profesora.
    return {
      data: [
        { profe_id: PROFE_A, aula_id: AULA, tipo_personal_aula: 'coordinadora' },
        { profe_id: PROFE_B, aula_id: AULA, tipo_personal_aula: 'profesora' },
      ],
      error: null,
    }
  }
  return { data: [], error: null }
}

function fakeClient() {
  return {
    rpc: () => Promise.resolve({ data: ORIGEN, error: null }),
    from: (tabla: string) => {
      let res: { data: unknown; error: unknown } = { data: null, error: null }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {}
      b.select = (columnas: string) => {
        registro.selects.push({ tabla, columnas })
        const n = selectsPorTabla[tabla] ?? 0
        selectsPorTabla[tabla] = n + 1
        res = respuesta(tabla, n)
        return b
      }
      b.insert = (filas: unknown) => {
        registro.inserts.push({ tabla, filas })
        res = { data: null, error: null }
        return b
      }
      b.eq = () => b
      b.is = () => b
      b.maybeSingle = () => b
      b.then = (resolve: (v: unknown) => unknown) => resolve(res)
      return b
    },
  }
}

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fakeClient() }))

const { copiarConfigCurso } = await import('../copiar-config-curso')

describe('copiarConfigCurso — personal sin es_profe_principal', () => {
  beforeEach(() => {
    registro.selects = []
    registro.inserts = []
    selectsPorTabla = {}
  })

  it('ninguna consulta pide la columna borrada', async () => {
    const r = await copiarConfigCurso({ curso_destino_id: DESTINO, incluir_personal: true })
    expect(r.success).toBe(true)
    for (const s of registro.selects) expect(s.columnas).not.toContain('es_profe_principal')
  })

  it('copia el personal con su rol y sin la columna borrada', async () => {
    const r = await copiarConfigCurso({ curso_destino_id: DESTINO, incluir_personal: true })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.personalCopiado).toBe(2)

    const insert = registro.inserts.find((i) => i.tabla === 'profes_aulas')
    expect(insert?.filas).toStrictEqual([
      {
        profe_id: PROFE_A,
        aula_id: AULA,
        curso_academico_id: DESTINO,
        tipo_personal_aula: 'coordinadora',
      },
      {
        profe_id: PROFE_B,
        aula_id: AULA,
        curso_academico_id: DESTINO,
        tipo_personal_aula: 'profesora',
      },
    ])
  })
})
