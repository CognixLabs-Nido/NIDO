import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El aviso «Alergia grave» del pase de lista, la agenda del aula y el comedor.
 *
 * Las cuatro consultas filtraban por `info_medica_emergencia.deleted_at`, una columna que esa
 * tabla no tiene: la consulta fallaba siempre, el error se ignoraba y todos los niños salían
 * «sin alergia». Que la consulta funcione contra el esquema real lo prueba
 * `src/test/rls/alertas-medicas.rls.test.ts`; aquí, que un fallo de esa consulta no vuelva a
 * pintarse como «sin alergia»: la función lanza y la lista no sale.
 */

const NINO = '11111111-1111-4111-8111-111111111111'
const AULA = '22222222-2222-4222-8222-222222222222'
const CENTRO = '33333333-3333-4333-8333-333333333333'

type Resultado = { data: unknown; error: { message: string } | null }

let medicas: Resultado

/** Lo que devuelve cada tabla; lo que no está aquí no tiene filas. */
function resultadoDe(tabla: string): Resultado {
  switch (tabla) {
    case 'info_medica_emergencia':
      return medicas
    case 'matriculas':
      return {
        data: [
          {
            ninos: {
              id: NINO,
              nombre: 'Niño',
              apellidos: 'Demo',
              fecha_nacimiento: '2024-03-15',
              foto_url: null,
            },
          },
        ],
        error: null,
      }
    case 'aulas':
      return { data: { centro_id: CENTRO }, error: null }
    case 'plantillas_menu_mensual':
      return { data: { id: 'plantilla' }, error: null }
    case 'menu_dia':
      return { data: { id: 'menu', fecha: '2026-10-26' }, error: null }
    default:
      return { data: [], error: null }
  }
}

/** Cadena de PostgREST: cualquier filtro devuelve la misma consulta; al esperarla, su resultado. */
function consulta(resultado: () => Resultado): unknown {
  const q: unknown = new Proxy(
    {},
    {
      get: (_, prop) =>
        prop === 'then' ? (resolve: (r: Resultado) => unknown) => resolve(resultado()) : () => q,
    }
  )
  return q
}

const RPC: Record<string, unknown> = { tipo_de_dia: 'lectivo', nino_toma_comida_solida: true }

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (tabla: string) => consulta(() => resultadoDe(tabla)),
    rpc: (fn: string) => consulta(() => ({ data: RPC[fn] ?? null, error: null })),
  }),
}))

const { getPaseDeListaAula } = await import('@/features/asistencia/queries/get-pase-de-lista-aula')
const { getAgendasAulaDelDia } =
  await import('@/features/agenda-diaria/queries/get-agendas-aula-del-dia')
const { getPaseDeListaComida } = await import('@/features/menus/queries/get-pase-de-lista-comida')
const { getPaseDeListaComidaTodosMomentos } =
  await import('@/features/menus/queries/get-pase-de-lista-comida-todos-momentos')

const FECHA = '2026-10-26'
const CON_ALERGIA: Resultado = {
  data: [{ nino_id: NINO, alergias_graves: '\\x00', medicacion_habitual: null }],
  error: null,
}
const FALLO: Resultado = { data: null, error: { message: 'fallo de la consulta' } }

/** Si el niño sale con el aviso de alergia grave, según la forma de cada pantalla. */
const pantallas: Array<[string, () => Promise<boolean>]> = [
  [
    'pase de lista',
    async () => (await getPaseDeListaAula(AULA, FECHA))[0]?.alertas.alergia_grave ?? false,
  ],
  [
    'agenda del aula',
    async () => (await getAgendasAulaDelDia(AULA, FECHA))[0]?.alertas.alergia_grave ?? false,
  ],
  [
    'comedor (un momento)',
    async () => {
      const s = await getPaseDeListaComida(AULA, FECHA, 'comida')
      return s.kind === 'listo' && (s.filas[0]?.alergiaGrave ?? false)
    },
  ],
  [
    'comedor (todos los momentos)',
    async () => {
      const s = (await getPaseDeListaComidaTodosMomentos(AULA, FECHA)).comida
      return s.kind === 'listo' && (s.filas[0]?.alergiaGrave ?? false)
    },
  ],
]

describe('Un fallo de las alertas médicas no se pinta como «sin alergia»', () => {
  beforeEach(() => {
    medicas = CON_ALERGIA
  })

  it.each(pantallas)('%s: premisa, con la fila de alergia sale el aviso', async (_, aviso) => {
    expect(await aviso()).toBe(true)
  })

  it.each(pantallas)('%s: si la consulta falla, lanza', async (_, aviso) => {
    medicas = FALLO
    await expect(aviso()).rejects.toThrow('alertas médicas: fallo de la consulta')
  })
})
