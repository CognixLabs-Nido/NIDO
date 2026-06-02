import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

// El snapshot de invitados se prueba aparte (lib/invitados.test.ts); aquí lo
// controlamos para aislar la orquestación de crearCita.
const snapshotMock = vi.fn()
vi.mock('../../lib/invitados', () => ({
  resolverInvitadosSnapshot: (...args: unknown[]) => snapshotMock(...args),
}))

// createServiceClient solo lo usa la limpieza best-effort.
const serviceDeleteSpy = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(() =>
    Promise.resolve({
      from: () => ({
        delete: () => ({
          eq: () => {
            serviceDeleteSpy()
            return Promise.resolve({ error: null })
          },
        }),
      }),
    })
  ),
}))

import { crearCitaCore } from '../crear-cita'

const USER = '11111111-1111-4111-8111-111111111111'
const NINO = '22222222-2222-4222-8222-222222222222'
const AULA = '55555555-5555-4555-8555-555555555555'
const CENTRO = '33333333-3333-4333-8333-333333333333'
const CITA = '44444444-4444-4444-8444-444444444444'

interface Setup {
  ninoCentro?: string
  aulaCentro?: string
  rolCentro?: string
  esAdmin?: boolean
  esProfeNino?: boolean
  esProfeAula?: boolean
  citaInsert?: { id: string } | null
  citaInsertError?: { code?: string; message: string } | null
  invitadosError?: { code?: string; message: string } | null
}

function makeFake(setup: Setup) {
  const citaInsertSpy = vi.fn()
  const invitadosInsertSpy = vi.fn()
  const fake = {
    rpc: (fn: string) => {
      const map: Record<string, boolean | undefined> = {
        es_admin: setup.esAdmin,
        es_profe_de_nino: setup.esProfeNino,
        es_profe_de_aula: setup.esProfeAula,
      }
      return Promise.resolve({ data: map[fn] ?? false, error: null })
    },
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.is = () => b
      b.limit = () => b
      b.maybeSingle = () => {
        if (table === 'ninos')
          return Promise.resolve({
            data: setup.ninoCentro ? { centro_id: setup.ninoCentro } : null,
            error: null,
          })
        if (table === 'aulas')
          return Promise.resolve({
            data: setup.aulaCentro ? { centro_id: setup.aulaCentro } : null,
            error: null,
          })
        if (table === 'roles_usuario')
          return Promise.resolve({
            data: setup.rolCentro ? { centro_id: setup.rolCentro } : null,
            error: null,
          })
        return Promise.resolve({ data: null, error: null })
      }
      b.single = () =>
        Promise.resolve({ data: setup.citaInsert ?? null, error: setup.citaInsertError ?? null })
      b.insert = (payload: unknown) => {
        if (table === 'citas') {
          citaInsertSpy(payload)
          return b
        }
        invitadosInsertSpy(payload)
        return Promise.resolve({ error: setup.invitadosError ?? null })
      }
      return b
    },
  } as unknown as SupabaseClient<Database>
  return { fake, citaInsertSpy, invitadosInsertSpy }
}

const claustro = {
  tipo: 'reunion_claustro' as const,
  titulo: 'Claustro',
  fecha: '2026-09-10',
  hora_inicio: '17:00',
}

beforeEach(() => {
  vi.clearAllMocks()
  snapshotMock.mockResolvedValue({ internos: ['t1', 't2'], externos: [] })
})

describe('crearCitaCore', () => {
  it('reunion_claustro: resuelve centro del organizador, inserta cita + invitados', async () => {
    const { fake, citaInsertSpy, invitadosInsertSpy } = makeFake({
      rolCentro: CENTRO,
      esAdmin: true,
      citaInsert: { id: CITA },
    })
    const res = await crearCitaCore(fake, USER, claustro)
    expect(res.success).toBe(true)
    if (res.success) expect(res.data.cita_id).toBe(CITA)
    expect(citaInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ centro_id: CENTRO, tipo: 'reunion_claustro', organizador_id: USER })
    )
    expect(invitadosInsertSpy).toHaveBeenCalledWith([
      { cita_id: CITA, centro_id: CENTRO, usuario_id: 't1' },
      { cita_id: CITA, centro_id: CENTRO, usuario_id: 't2' },
    ])
  })

  it('reunion_familia: resuelve centro del niño; profe del niño autorizado', async () => {
    const { fake, citaInsertSpy } = makeFake({
      ninoCentro: CENTRO,
      esProfeNino: true,
      citaInsert: { id: CITA },
    })
    const res = await crearCitaCore(fake, USER, {
      tipo: 'reunion_familia',
      nino_id: NINO,
      titulo: 'Reunión',
      fecha: '2026-09-10',
      hora_inicio: '17:00',
    })
    expect(res.success).toBe(true)
    expect(citaInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ centro_id: CENTRO, nino_id: NINO, aula_id: null })
    )
  })

  it('falla si el llamante no puede organizar (pre-auth)', async () => {
    const { fake, citaInsertSpy } = makeFake({ aulaCentro: CENTRO, esProfeAula: false })
    const res = await crearCitaCore(fake, USER, {
      tipo: 'reunion_clase',
      aula_id: AULA,
      titulo: 'Clase',
      fecha: '2026-09-10',
      hora_inicio: '17:00',
    })
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('citas.errors.no_autorizado')
    expect(citaInsertSpy).not.toHaveBeenCalled()
  })

  it('falla si el snapshot queda vacío (no crea cita huérfana)', async () => {
    snapshotMock.mockResolvedValue({ internos: [], externos: [] })
    const { fake, citaInsertSpy } = makeFake({ rolCentro: CENTRO, esAdmin: true })
    const res = await crearCitaCore(fake, USER, claustro)
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('citas.errors.sin_invitados')
    expect(citaInsertSpy).not.toHaveBeenCalled()
  })

  it('limpia la cita (service role) si falla el batch de invitados', async () => {
    const { fake } = makeFake({
      rolCentro: CENTRO,
      esAdmin: true,
      citaInsert: { id: CITA },
      invitadosError: { message: 'boom' },
    })
    const res = await crearCitaCore(fake, USER, claustro)
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('citas.errors.invitados_fallo')
    expect(serviceDeleteSpy).toHaveBeenCalled()
  })
})
