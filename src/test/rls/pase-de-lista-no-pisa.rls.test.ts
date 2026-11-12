import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'

import { hayTestId, propsDe, type SesionConFallos } from './lectura-fallida'
import {
  asignarProfeAula,
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * El pase de lista no se pasa sobre lo que no se leyó (2026-11-12). Si la lectura de las asistencias
 * de hoy falla, cada fila sale en blanco, y «todos presentes» + «guardar» escribe la fila entera por
 * (niño, fecha): pisa la hora de llegada y vacía la salida y la observación de lo ya apuntado. Si
 * falla solo la de las ausencias, el niño cuya familia avisó de que no viene sale sin el aviso y queda
 * «presente»: el registro de quién está dentro del centro. Se monta la cadena entera: la PÁGINA real
 * con la sesión real de la profe del aula, el pase con lo que ella le da, la acción real, y la tabla
 * leída después. Lo que se afirma es la tabla: si la pantalla ofrece pasar lista, se pasa.
 */
const sesion = vi.hoisted(
  (): SesionConFallos => ({ actual: null, fallaTabla: null, fallaRpc: null, fallidas: 0 })
)
vi.mock('@/lib/supabase/server', async () => {
  const { clienteConFallos: con } = await import('./lectura-fallida')
  return { createClient: async () => con(sesion) }
})
vi.mock('@/lib/supabase/client', () => {
  const canal = { on: () => canal, subscribe: () => canal }
  return { createClient: () => ({ channel: () => canal, removeChannel: () => undefined }) }
})
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
  redirect: (u: string) => {
    throw new Error(`REDIRECT ${u}`)
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/es/teacher',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next-intl/server', () => ({
  getTranslations: async () =>
    Object.assign((k: string) => k, { has: () => true, rich: (k: string) => k }),
}))
vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign((k: string) => k, { has: () => true }),
}))
const accion = vi.hoisted(() => ({ llamadas: [] as Promise<unknown>[] }))
vi.mock('@/features/asistencia/actions/batch-upsert-asistencias', async (original) => {
  const m =
    await original<typeof import('@/features/asistencia/actions/batch-upsert-asistencias')>()
  return {
    ...m,
    batchUpsertAsistencias: (...a: Parameters<typeof m.batchUpsertAsistencias>) => {
      const r = m.batchUpsertAsistencias(...a)
      accion.llamadas.push(r)
      return r
    },
  }
})

const { default: PaginaAsistencia } =
  await import('@/app/[locale]/teacher/aula/[id]/asistencia/page')
const { PaseDeListaCliente } = await import('@/features/asistencia/components/PaseDeListaCliente')

type PropsPase = Parameters<typeof PaseDeListaCliente>[0]

const HOY = hoyMadrid()
const APUNTADA_A = {
  estado: 'presente',
  hora_llegada: '08:30:00',
  hora_salida: null,
  observaciones: 'Fiebre a media mañana',
} as const
const CONSERVA_A = APUNTADA_A

describe('el pase de lista no se pasa sobre lo que no se leyó', () => {
  let aula: { id: string }
  let a: { id: string }
  let b: { id: string }
  let profe: TestUser

  beforeAll(async () => {
    const centro = await createTestCentro('Centro Pase No Pisa')
    const curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    a = await createTestNino(centro.id, 'Ana Pase No Pisa')
    b = await createTestNino(centro.id, 'Bruno Pase No Pisa')
    await matricular(a.id, aula.id, curso.id)
    await matricular(b.id, aula.id, curso.id)
    profe = await createTestUser({ nombre: 'Profe Pase No Pisa' })
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarProfeAula(profe.id, aula.id, curso.id)
    const aus = await serviceClient
      .from('ausencias')
      .insert({ nino_id: b.id, fecha_inicio: HOY, fecha_fin: HOY, motivo: 'enfermedad' })
    if (aus.error) throw new Error(`ausencia: ${aus.error.message}`)
    sesion.actual = await clientFor(profe)
  })

  afterAll(async () => {
    sesion.actual = null
    await serviceClient.from('asistencias').delete().in('nino_id', [a.id, b.id])
    await serviceClient.from('ausencias').delete().eq('nino_id', b.id)
    if (profe) await deleteTestUser(profe.id)
  })

  beforeEach(async () => {
    // Cada test parte de lo mismo: A con lo apuntado esta mañana, B sin asistencia (su familia avisó).
    const r = await serviceClient
      .from('asistencias')
      .upsert({ nino_id: a.id, fecha: HOY, ...APUNTADA_A }, { onConflict: 'nino_id,fecha' })
    if (r.error) throw new Error(`asistencia de A: ${r.error.message}`)
    const d = await serviceClient.from('asistencias').delete().eq('nino_id', b.id)
    if (d.error) throw new Error(`asistencia de B: ${d.error.message}`)
    accion.llamadas = []
  })

  afterEach(() => {
    sesion.fallaTabla = null
  })

  async function asistenciaDe(ninoId: string) {
    const { data, error } = await serviceClient
      .from('asistencias')
      .select('estado, hora_llegada, hora_salida, observaciones')
      .eq('nino_id', ninoId)
      .eq('fecha', HOY)
      .maybeSingle()
    if (error) throw new Error(`leer asistencia: ${error.message}`)
    return data
  }

  /** La página con la sesión de la profe; `falla`, la tabla cuya lectura contesta error al pintar. */
  async function pagina(falla: string | null) {
    sesion.fallaTabla = falla
    sesion.fallidas = 0
    const arbol = await PaginaAsistencia({
      params: Promise.resolve({ id: aula.id, locale: 'es' }),
      searchParams: Promise.resolve({}),
    })
    if (falla) expect(sesion.fallidas).toBeGreaterThan(0) // premisa: el fallo entró
    sesion.fallaTabla = null
    return arbol
  }

  /** Si la pantalla ofrece pasar lista: «todos presentes» y «guardar», y espera a la acción. */
  async function todosPresentesYGuardar(p: PropsPase) {
    render(createElement(PaseDeListaCliente, p))
    fireEvent.click(screen.getByTestId('pase-quick-todos-presentes'))
    fireEvent.click(screen.getByTestId('pase-submit'))
    await waitFor(() => expect(accion.llamadas.length).toBeGreaterThan(0), { timeout: 30_000 })
    const r = await accion.llamadas[0]
    expect(r, JSON.stringify(r)).toMatchObject({ success: true }) // premisa: el guardado corrió
  }

  async function aIntacta() {
    const f = await asistenciaDe(a.id)
    for (const [k, v] of Object.entries(CONSERVA_A))
      expect.soft((f as Record<string, unknown> | null)?.[k], `A.${k}`).toBe(v)
  }

  it('control: con las dos lecturas bien, A abre con lo apuntado y guardar un cambio conserva lo demás', async () => {
    expect(await asistenciaDe(a.id)).toMatchObject(APUNTADA_A) // premisa
    const p = propsDe<PropsPase>(await pagina(null), PaseDeListaCliente)
    expect(p).not.toBeNull()
    expect(p!.filas.find((f) => f.nino.id === a.id)?.asistencia).toMatchObject(APUNTADA_A)
    expect(p!.filas.find((f) => f.nino.id === b.id)?.ausencia).not.toBeNull()
    render(createElement(PaseDeListaCliente, p!))
    fireEvent.change(screen.getByTestId(`pase-cell-${a.id}-observaciones`), {
      target: { value: 'Fiebre a media mañana; ya bien' },
    })
    fireEvent.click(screen.getByTestId('pase-submit'))
    await waitFor(() => expect(accion.llamadas.length).toBeGreaterThan(0), { timeout: 30_000 })
    const r = await accion.llamadas[0]
    expect(r, JSON.stringify(r)).toMatchObject({ success: true })
    expect(await asistenciaDe(a.id)).toMatchObject({
      ...APUNTADA_A,
      observaciones: 'Fiebre a media mañana; ya bien',
    })
  })

  it('control: con las dos lecturas bien, B sale con el aviso de la familia y se ofrece guardar', async () => {
    const p = propsDe<PropsPase>(await pagina(null), PaseDeListaCliente)
    expect(p).not.toBeNull()
    render(createElement(PaseDeListaCliente, p!))
    expect(screen.getAllByText('badge.ausencia_reportada')).toHaveLength(1)
    expect(screen.getByTestId('pase-submit')).toBeDefined()
  })

  async function medir(falla: 'asistencias' | 'ausencias') {
    const arbol = await pagina(falla)
    const p = propsDe<PropsPase>(arbol, PaseDeListaCliente)
    if (p) await todosPresentesYGuardar(p)
    // Si no se ofrece pasar lista, se dice por qué.
    else expect.soft(hayTestId(arbol, 'pase-lista-no-leido'), 'aviso de no leído').toBe(true)
  }

  it('P1 · falla la lectura de las asistencias: lo apuntado de A sigue entero', async () => {
    await medir('asistencias')
    await aIntacta()
  })

  it('P2 · por la mañana, falla solo la lectura de las ausencias: B no queda presente', async () => {
    const d = await serviceClient.from('asistencias').delete().eq('nino_id', a.id)
    if (d.error) throw new Error(`asistencia de A: ${d.error.message}`)
    expect(await asistenciaDe(a.id)).toBeNull() // premisa: nadie ha pasado lista todavía
    await medir('ausencias')
    expect.soft((await asistenciaDe(b.id))?.estado ?? null, 'B.estado').toBeNull()
  })
})
