import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'

import { propsDe, type SesionConFallos } from './lectura-fallida'
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
 * El pase de lista, con las dos lecturas bien (2026-11-13), cerrado antes de que una profe lo abra:
 * - «todos presentes» solo rellena las filas SIN DECIDIR: no toca al niño cuya familia avisó de que
 *   no viene (sale prellenado «ausente», con la etiqueta) ni las filas que la profe ya marcó;
 * - una fila que ya tiene la hora de llegada se puede volver a guardar: cambiar la nota por la tarde
 *   en la fila de la llegada de la mañana, y corregir una hora mal puesta. La base devuelve la hora
 *   como 'HH:MM:SS' y el pase la reenvía tal cual (medido: `hora_invalida` sin el arreglo).
 * La PÁGINA real con la sesión real de la profe del aula, el pase con lo que ella le da, la acción
 * real, y la tabla leída después con service_role. Predicciones: ~/nido-logs/agujero/pase-lista-cerrado.
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

describe('el pase de lista, con las lecturas bien', () => {
  let aula: { id: string }
  let a: { id: string }
  let b: { id: string }
  let c: { id: string }
  let profe: TestUser

  beforeAll(async () => {
    const centro = await createTestCentro('Centro Pase Cerrado')
    const curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    a = await createTestNino(centro.id, 'Ana Pase Cerrado')
    b = await createTestNino(centro.id, 'Bruno Pase Cerrado')
    c = await createTestNino(centro.id, 'Carla Pase Cerrado')
    for (const n of [a, b, c]) await matricular(n.id, aula.id, curso.id)
    profe = await createTestUser({ nombre: 'Profe Pase Cerrado' })
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
    await serviceClient.from('asistencias').delete().in('nino_id', [a.id, b.id, c.id])
    await serviceClient.from('ausencias').delete().eq('nino_id', b.id)
    if (profe) await deleteTestUser(profe.id)
  })

  beforeEach(async () => {
    // A sin decidir, B con la ausencia avisada y sin fila, C marcada «ausente» por la profe.
    const d = await serviceClient.from('asistencias').delete().in('nino_id', [a.id, b.id])
    if (d.error) throw new Error(`limpiar: ${d.error.message}`)
    const r = await serviceClient
      .from('asistencias')
      .upsert({ nino_id: c.id, fecha: HOY, estado: 'ausente' }, { onConflict: 'nino_id,fecha' })
    if (r.error) throw new Error(`C: ${r.error.message}`)
    accion.llamadas = []
  })

  async function fila(ninoId: string) {
    const { data, error } = await serviceClient
      .from('asistencias')
      .select('estado, hora_llegada, observaciones')
      .eq('nino_id', ninoId)
      .eq('fecha', HOY)
      .maybeSingle()
    if (error) throw new Error(`leer asistencia: ${error.message}`)
    return data
  }

  /** La página con la sesión de la profe, pintada de nuevo (como al volver a entrar). */
  async function pase(): Promise<PropsPase> {
    cleanup()
    accion.llamadas = []
    const p = propsDe<PropsPase>(
      await PaginaAsistencia({
        params: Promise.resolve({ id: aula.id, locale: 'es' }),
        searchParams: Promise.resolve({}),
      }),
      PaseDeListaCliente
    )
    if (!p) throw new Error('la página no ofreció el pase de lista')
    render(createElement(PaseDeListaCliente, p))
    return p
  }

  function hora(ninoId: string, valor: string) {
    fireEvent.change(screen.getByTestId(`pase-cell-${ninoId}-hora_llegada`), {
      target: { value: valor },
    })
  }

  /** «Guardar» y lo que contestó la acción. */
  async function guardar() {
    fireEvent.click(screen.getByTestId('pase-submit'))
    await waitFor(() => expect(accion.llamadas.length).toBeGreaterThan(0), { timeout: 30_000 })
    return await accion.llamadas[0]
  }

  // ---------- «todos presentes» ----------

  it('T · «todos presentes» rellena lo sin decidir y no toca lo ya decidido', async () => {
    const p = await pase()
    // premisas: la ausencia de B se leyó y se ve; C llega marcada «ausente»; A, sin fila
    expect(p.filas.find((f) => f.nino.id === b.id)?.ausencia).not.toBeNull()
    expect(screen.getAllByText('badge.ausencia_reportada')).toHaveLength(1)
    expect(p.filas.find((f) => f.nino.id === c.id)?.asistencia?.estado).toBe('ausente')
    expect(await fila(a.id)).toBeNull()
    fireEvent.click(screen.getByTestId('pase-quick-todos-presentes'))
    const r = await guardar()
    expect(r, `respuesta: ${JSON.stringify(r)}`).toMatchObject({ success: true })
    // control positivo: el botón sigue rellenando lo que estaba sin decidir
    expect((await fila(a.id))?.estado).toBe('presente')
    expect.soft((await fila(b.id))?.estado ?? null, 'B (ausencia avisada)').toBeNull()
    expect.soft((await fila(c.id))?.estado, 'C (marcada ausente)').toBe('ausente')
  })

  // ---------- una fila que ya tiene hora ----------

  it('H1 · la llegada por la mañana y, por la tarde, una nota en la misma fila', async () => {
    await pase()
    fireEvent.click(screen.getByTestId(`pase-cell-${a.id}-estado-presente`))
    hora(a.id, '08:30')
    const manana = await guardar()
    // premisa: por la mañana se guarda (la fila no traía hora)
    expect(manana, `mañana: ${JSON.stringify(manana)}`).toMatchObject({ success: true })
    expect((await fila(a.id))?.hora_llegada).toBe('08:30:00')

    const p = await pase()
    // premisa: por la tarde la fila llega con la hora como la devuelve la base
    expect(p.filas.find((f) => f.nino.id === a.id)?.asistencia?.hora_llegada).toBe('08:30:00')
    // Solo se cambia la nota: la llegada viaja como la leyó el pase.
    fireEvent.change(screen.getByTestId(`pase-cell-${a.id}-observaciones`), {
      target: { value: 'Se ha dormido después de comer' },
    })
    const tarde = await guardar()
    expect.soft(tarde, `tarde: ${JSON.stringify(tarde)}`).toMatchObject({ success: true })
    expect.soft(await fila(a.id), 'la fila').toMatchObject({
      estado: 'presente',
      hora_llegada: '08:30:00',
      observaciones: 'Se ha dormido después de comer',
    })
  })

  it('H2 · corregir una hora mal puesta', async () => {
    const r0 = await serviceClient
      .from('asistencias')
      .insert({ nino_id: a.id, fecha: HOY, estado: 'presente', hora_llegada: '08:30' })
    if (r0.error) throw new Error(r0.error.message)
    const p = await pase()
    expect(p.filas.find((f) => f.nino.id === a.id)?.asistencia?.hora_llegada).toBe('08:30:00')
    hora(a.id, '08:45')
    const r = await guardar()
    expect.soft(r, `corregir: ${JSON.stringify(r)}`).toMatchObject({ success: true })
    expect.soft((await fila(a.id))?.hora_llegada, 'la llegada').toBe('08:45:00')
  })
})
