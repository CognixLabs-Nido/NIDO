import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

// El push es best-effort y va al final. Lo neutralizamos: destinatarios = []
// (así el guard `length > 0` salta el envío y no se toca service role).
vi.mock('../lib/audiencia', () => ({
  expandirDestinatariosRecordatorio: vi.fn(() => Promise.resolve([])),
}))

import { crearRecordatorioCore } from '../crear-recordatorio'

// UUIDs v4 válidos (versión '4' + variante '8'): el core re-valida con
// z.uuid() (Zod v4), que rechaza UUIDs todo-ceros por variante inválida.
const USER_ID = '11111111-1111-4111-8111-111111111111'
const NINO_ID = '22222222-2222-4222-8222-222222222222'
const CENTRO_ID = '33333333-3333-4333-8333-333333333333'
const REC_ID = '44444444-4444-4444-8444-444444444444'
const AULA_ID = '55555555-5555-4555-8555-555555555555'
const PROFE_ID = '66666666-6666-4666-8666-666666666666'

interface FakeSetup {
  ninoCentro?: string | null
  aulaCentro?: string | null
  rolCentro?: string | null
  insertResult?: { id: string } | null
  insertError?: { code?: string; message: string } | null
}

function makeFakeClient(setup: FakeSetup) {
  const insertSpy = vi.fn()
  const fake = {
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.is = () => b
      b.limit = () => b
      b.insert = (payload: Record<string, unknown>) => {
        insertSpy(payload)
        return b
      }
      b.maybeSingle = () => {
        if (table === 'ninos') {
          return Promise.resolve({
            data: setup.ninoCentro === undefined ? null : { centro_id: setup.ninoCentro },
            error: null,
          })
        }
        if (table === 'aulas') {
          return Promise.resolve({
            data: setup.aulaCentro === undefined ? null : { centro_id: setup.aulaCentro },
            error: null,
          })
        }
        if (table === 'roles_usuario') {
          return Promise.resolve({
            data: setup.rolCentro ? { centro_id: setup.rolCentro } : null,
            error: null,
          })
        }
        return Promise.resolve({ data: null, error: null })
      }
      b.single = () =>
        Promise.resolve({
          data: setup.insertResult ?? null,
          error: setup.insertError ?? null,
        })
      return b
    },
  } as unknown as SupabaseClient<Database>
  return { fake, insertSpy }
}

describe('crearRecordatorioCore — modelo granular F6-C', () => {
  it('familia_individual: deriva centro del niño; INSERT con nino_id, sin aula ni usuario', async () => {
    const { fake, insertSpy } = makeFakeClient({
      ninoCentro: CENTRO_ID,
      insertResult: { id: REC_ID },
    })

    const res = await crearRecordatorioCore(fake, USER_ID, {
      destinatario: 'familia_individual',
      nino_id: NINO_ID,
      titulo: 'traer cartilla de vacunas',
      vencimiento: '2026-06-05T09:00:00.000Z',
    })

    expect(res.success).toBe(true)
    if (res.success) expect(res.data.recordatorio_id).toBe(REC_ID)
    expect(insertSpy.mock.calls[0]?.[0]).toMatchObject({
      centro_id: CENTRO_ID,
      destinatario: 'familia_individual',
      nino_id: NINO_ID,
      aula_id: null,
      usuario_destinatario_id: null,
      creado_por: USER_ID,
    })
  })

  it('familias_aula: deriva centro del aula; INSERT con aula_id, sin niño ni usuario', async () => {
    const { fake, insertSpy } = makeFakeClient({
      aulaCentro: CENTRO_ID,
      insertResult: { id: REC_ID },
    })

    const res = await crearRecordatorioCore(fake, USER_ID, {
      destinatario: 'familias_aula',
      aula_id: AULA_ID,
      titulo: 'mañana excursión, traer gorra',
    })

    expect(res.success).toBe(true)
    expect(insertSpy.mock.calls[0]?.[0]).toMatchObject({
      centro_id: CENTRO_ID,
      destinatario: 'familias_aula',
      nino_id: null,
      aula_id: AULA_ID,
      usuario_destinatario_id: null,
      creado_por: USER_ID,
    })
  })

  it('familias_centro: deriva centro del rol del usuario; sin referencias', async () => {
    const { fake, insertSpy } = makeFakeClient({
      rolCentro: CENTRO_ID,
      insertResult: { id: REC_ID },
    })

    const res = await crearRecordatorioCore(fake, USER_ID, {
      destinatario: 'familias_centro',
      titulo: 'el viernes cerramos antes',
    })

    expect(res.success).toBe(true)
    expect(insertSpy.mock.calls[0]?.[0]).toMatchObject({
      centro_id: CENTRO_ID,
      destinatario: 'familias_centro',
      nino_id: null,
      aula_id: null,
      usuario_destinatario_id: null,
    })
  })

  it('profe_individual: centro del rol; usuario_destinatario_id = la profe elegida', async () => {
    const { fake, insertSpy } = makeFakeClient({
      rolCentro: CENTRO_ID,
      insertResult: { id: REC_ID },
    })

    const res = await crearRecordatorioCore(fake, USER_ID, {
      destinatario: 'profe_individual',
      usuario_destinatario_id: PROFE_ID,
      titulo: 'revisa el parte de Lucas',
    })

    expect(res.success).toBe(true)
    expect(insertSpy.mock.calls[0]?.[0]).toMatchObject({
      centro_id: CENTRO_ID,
      destinatario: 'profe_individual',
      nino_id: null,
      aula_id: null,
      usuario_destinatario_id: PROFE_ID,
      creado_por: USER_ID,
    })
  })

  it('profes_centro: centro del rol; sin referencias', async () => {
    const { fake, insertSpy } = makeFakeClient({
      rolCentro: CENTRO_ID,
      insertResult: { id: REC_ID },
    })

    const res = await crearRecordatorioCore(fake, USER_ID, {
      destinatario: 'profes_centro',
      titulo: 'reunión de claustro el lunes',
    })

    expect(res.success).toBe(true)
    expect(insertSpy.mock.calls[0]?.[0]).toMatchObject({
      centro_id: CENTRO_ID,
      destinatario: 'profes_centro',
      usuario_destinatario_id: null,
    })
  })

  it('personal: centro del rol; usuario_destinatario_id = creador', async () => {
    const { fake, insertSpy } = makeFakeClient({
      rolCentro: CENTRO_ID,
      insertResult: { id: REC_ID },
    })

    const res = await crearRecordatorioCore(fake, USER_ID, {
      destinatario: 'personal',
      titulo: 'llamar al proveedor de menús',
    })

    expect(res.success).toBe(true)
    expect(insertSpy.mock.calls[0]?.[0]).toMatchObject({
      centro_id: CENTRO_ID,
      destinatario: 'personal',
      nino_id: null,
      aula_id: null,
      usuario_destinatario_id: USER_ID,
      creado_por: USER_ID,
    })
  })

  it('familia_individual sin niño visible (RLS lo oculta): nino_no_encontrado', async () => {
    const { fake } = makeFakeClient({ ninoCentro: undefined })
    const res = await crearRecordatorioCore(fake, USER_ID, {
      destinatario: 'familia_individual',
      nino_id: NINO_ID,
      titulo: 'x',
    })
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('recordatorios.errors.nino_no_encontrado')
  })

  it('familias_aula sin aula visible: aula_no_encontrada', async () => {
    const { fake } = makeFakeClient({ aulaCentro: undefined })
    const res = await crearRecordatorioCore(fake, USER_ID, {
      destinatario: 'familias_aula',
      aula_id: AULA_ID,
      titulo: 'x',
    })
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('recordatorios.errors.aula_no_encontrada')
  })

  it('cross-field inválido (familia_individual sin nino_id): rechazado por Zod', async () => {
    const { fake } = makeFakeClient({})
    const res = await crearRecordatorioCore(fake, USER_ID, {
      destinatario: 'familia_individual',
      titulo: 'x',
    })
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('recordatorios.validation.nino_requerido')
  })

  it('cross-field inválido (familias_aula sin aula_id): rechazado por Zod', async () => {
    const { fake } = makeFakeClient({})
    const res = await crearRecordatorioCore(fake, USER_ID, {
      destinatario: 'familias_aula',
      titulo: 'x',
    })
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('recordatorios.validation.aula_requerida')
  })

  it('INSERT 42501 (RLS): no_autorizado', async () => {
    const { fake } = makeFakeClient({
      aulaCentro: CENTRO_ID,
      insertResult: null,
      insertError: { code: '42501', message: 'rls' },
    })
    const res = await crearRecordatorioCore(fake, USER_ID, {
      destinatario: 'familias_aula',
      aula_id: AULA_ID,
      titulo: 'intento sin permiso',
    })
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toBe('recordatorios.errors.no_autorizado')
  })
})
