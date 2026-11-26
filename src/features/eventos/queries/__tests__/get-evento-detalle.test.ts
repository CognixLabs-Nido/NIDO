import { beforeEach, describe, expect, it, vi } from 'vitest'

import { esLecturaFallida } from '@/shared/lib/lectura-fallida'

/**
 * Censo C (re-clasificación 139, 2026-11-26): si la lectura de los vínculos de quien mira falla, nadie confirma
 * (ningún botón que la base rechazaría), pero antes el tutor legal veía el evento SIN el bloque de confirmar, como
 * si no tuviera hijos en él. Ahora el detalle lo marca (`confirmaciones_leidas: false`) y la vista de familia lo
 * dice. Y la lista del aula caída ya no es «nadie en el aula»: lanza.
 */
const st = vi.hoisted(() => ({ falla: null as string | null, ambito: 'nino' as 'nino' | 'aula' }))

const EV = {
  id: 'ev-1',
  ambito: 'nino',
  tipo: 'excursion',
  titulo: 'Excursión Demo',
  descripcion: null,
  lugar: null,
  fecha: '2099-06-01',
  fecha_fin: null,
  hora_inicio: null,
  hora_fin: null,
  requiere_confirmacion: true,
  estado: 'programado',
  aula_id: 'aula-1',
  nino_id: 'n1',
  centro_id: 'c1',
  creado_por: 'otro',
}
const RESP: Record<string, unknown> = {
  eventos: EV,
  matriculas: [{ nino_id: 'n1' }],
  ninos: [{ id: 'n1', nombre: 'Niño', apellidos: 'Demo 1' }],
  confirmaciones_evento: [],
  vinculos_familiares: [{ nino_id: 'n1' }],
}

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/logger', () => ({ logger: { warn: vi.fn() } }))
vi.mock('@/features/matriculas/lib/matricula-activa', () => ({
  aplicarMatriculaActiva: (q: unknown) => q,
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'tutor' } } }) },
    from: (t: string) => {
      const r =
        t === st.falla
          ? { data: null, error: { code: 'XX000', message: 'caída' } }
          : { data: t === 'eventos' ? { ...EV, ambito: st.ambito } : RESP[t], error: null }
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'is']) b[m] = () => b
      b.maybeSingle = () => Promise.resolve(r)
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(r).then(ok, ko)
      return b
    },
  }),
}))

const { getEventoDetalle } = await import('../get-evento-detalle')

beforeEach(() => {
  st.falla = null
  st.ambito = 'nino'
})

describe('getEventoDetalle · los vínculos y el aula que no se leyeron', () => {
  it('control: leído, el tutor legal puede confirmar y las confirmaciones están leídas', async () => {
    const d = await getEventoDetalle('ev-1')
    expect(d?.confirmaciones_leidas).toBe(true)
    expect(d?.roster.map((r) => [r.nino_id, r.puede_confirmar])).toEqual([['n1', true]])
  })

  it('con vinculos_familiares caída: nadie confirma, y el detalle lo marca como no leído', async () => {
    st.falla = 'vinculos_familiares'
    const d = await getEventoDetalle('ev-1')
    expect(d?.confirmaciones_leidas).toBe(false)
    expect(d?.roster.map((r) => r.puede_confirmar)).toEqual([false])
  })

  it('evento de aula con la lista del aula caída → LecturaFallida, no un roster vacío', async () => {
    st.ambito = 'aula'
    st.falla = 'matriculas'
    const e = await getEventoDetalle('ev-1').then(
      () => null,
      (x: unknown) => x
    )
    expect(esLecturaFallida(e), String(e)).toBe(true)
  })
})
