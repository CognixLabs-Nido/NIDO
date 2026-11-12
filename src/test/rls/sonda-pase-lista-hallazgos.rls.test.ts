import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
 * SONDA (no se mergea). Dos hallazgos del pase de lista, con las DOS lecturas bien:
 * (h) volver a guardar una fila con hora guardada; (t) «todos presentes» sobre un niño con ausencia
 * avisada. Predicciones: ~/nido-logs/agujero/pase-lista/predicciones.md.
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

describe('SONDA · pase de lista con las lecturas bien', () => {
  let aula: { id: string }
  let a: { id: string }
  let b: { id: string }
  let profe: TestUser

  beforeAll(async () => {
    const centro = await createTestCentro('Centro Sonda Pase')
    const curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    a = await createTestNino(centro.id, 'Ana Sonda Pase')
    b = await createTestNino(centro.id, 'Bruno Sonda Pase')
    await matricular(a.id, aula.id, curso.id)
    await matricular(b.id, aula.id, curso.id)
    profe = await createTestUser({ nombre: 'Profe Sonda Pase' })
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
    if (profe) await deleteTestUser(profe.id)
  })

  beforeEach(async () => {
    await serviceClient.from('asistencias').delete().in('nino_id', [a.id, b.id])
    accion.llamadas = []
  })

  async function pase() {
    const p = propsDe<PropsPase>(
      await PaginaAsistencia({
        params: Promise.resolve({ id: aula.id, locale: 'es' }),
        searchParams: Promise.resolve({}),
      }),
      PaseDeListaCliente
    )
    if (!p) throw new Error('sin pase')
    render(createElement(PaseDeListaCliente, p))
    return p
  }

  async function guardar() {
    fireEvent.click(screen.getByTestId('pase-submit'))
    await waitFor(() => expect(accion.llamadas.length).toBeGreaterThan(0), { timeout: 30_000 })
    return await accion.llamadas[0]
  }

  it('(h) una fila con hora guardada: «todos presentes» y guardar', async () => {
    const r0 = await serviceClient
      .from('asistencias')
      .insert({ nino_id: a.id, fecha: HOY, estado: 'presente', hora_llegada: '08:30' })
    if (r0.error) throw new Error(r0.error.message)
    const p = await pase()
    // premisa: la fila llega con la hora como la devuelve la base
    expect(p.filas.find((f) => f.nino.id === a.id)?.asistencia?.hora_llegada).toBe('08:30:00')
    fireEvent.click(screen.getByTestId('pase-quick-todos-presentes'))
    const r = await guardar()
    expect.soft(r, 'lo que contestó la acción').toMatchObject({ success: true })
  })

  it('(t) por la mañana, B con ausencia avisada: «todos presentes» y guardar', async () => {
    const p = await pase()
    expect(p.filas.find((f) => f.nino.id === b.id)?.ausencia).not.toBeNull() // premisa: se leyó
    expect(screen.getAllByText('badge.ausencia_reportada')).toHaveLength(1) // premisa: se ve
    fireEvent.click(screen.getByTestId('pase-quick-todos-presentes'))
    const r = await guardar()
    expect(r, JSON.stringify(r)).toMatchObject({ success: true }) // premisa: guardó
    const { data } = await serviceClient
      .from('asistencias')
      .select('estado')
      .eq('nino_id', b.id)
      .eq('fecha', HOY)
      .maybeSingle()
    expect.soft(data?.estado ?? null, 'B.estado').not.toBe('presente')
  })
})
