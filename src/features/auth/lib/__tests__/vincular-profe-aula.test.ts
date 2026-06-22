import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { crearVinculoProfeAula } from '../vincular-profe-aula'

/**
 * Tests del auto-vínculo profe↔aula (F11-C-2). Cubre el INSERT que ejecuta el
 * camino de accept de cuenta nueva (y, vía el mismo helper, el de B8): que persiste
 * el `tipo_personal_aula` correcto y el profe/aula correctos (aislamiento), y que
 * captura el 23505 de coordinadora como mensaje amable. Cliente Supabase falso con
 * cola de respuestas; `calls` registra el patch del insert.
 */

const PROFE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const AULA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'

interface Resp {
  data: unknown
  error: unknown
}

function makeFake(responses: Resp[]) {
  const calls: { table: string; op: 'insert' | 'update'; patch: unknown }[] = []
  let i = 0
  const next = (): Resp => responses[i++] ?? { data: null, error: null }

  function builder(table: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {}
    b.select = () => b
    b.eq = () => b
    b.is = () => b
    b.limit = () => b
    b.single = () => b
    b.maybeSingle = () => b
    b.insert = (patch: unknown) => {
      calls.push({ table, op: 'insert', patch })
      return b
    }
    b.update = (patch: unknown) => {
      calls.push({ table, op: 'update', patch })
      return b
    }
    b.then = (resolve: (v: Resp) => unknown) => resolve(next())
    return b
  }

  const fake = { from: (table: string) => builder(table) } as unknown as SupabaseClient<Database>
  return { fake, calls }
}

describe('crearVinculoProfeAula', () => {
  it('inserta en profes_aulas con el profe, aula y tipo correctos', async () => {
    const { fake, calls } = makeFake([{ data: null, error: null }])
    const r = await crearVinculoProfeAula(fake, {
      profeId: PROFE,
      aulaId: AULA,
      tipoPersonalAula: 'coordinadora',
    })
    expect(r.error).toBeNull()
    expect(calls[0]?.table).toBe('profes_aulas')
    expect(calls[0]?.patch).toMatchObject({
      profe_id: PROFE,
      aula_id: AULA,
      tipo_personal_aula: 'coordinadora',
    })
  })

  it('tipo NULL (invitación legacy) → default profesora', async () => {
    const { fake, calls } = makeFake([{ data: null, error: null }])
    const r = await crearVinculoProfeAula(fake, {
      profeId: PROFE,
      aulaId: AULA,
      tipoPersonalAula: null,
    })
    expect(r.error).toBeNull()
    expect(calls[0]?.patch).toMatchObject({ tipo_personal_aula: 'profesora' })
  })

  it('23505 de coordinadora → mensaje amable (decisión E)', async () => {
    const { fake } = makeFake([{ data: null, error: { code: '23505', message: 'dup' } }])
    const r = await crearVinculoProfeAula(fake, {
      profeId: PROFE,
      aulaId: AULA,
      tipoPersonalAula: 'coordinadora',
    })
    expect(r.error).toBe('auth.invitation.errors.coordinadora_ocupada')
  })

  it('error genérico de inserción → profe_aula_failed', async () => {
    const { fake } = makeFake([{ data: null, error: { code: '23503', message: 'fk' } }])
    const r = await crearVinculoProfeAula(fake, {
      profeId: PROFE,
      aulaId: AULA,
      tipoPersonalAula: 'profesora',
    })
    expect(r.error).toBe('auth.invitation.errors.profe_aula_failed')
  })
})
