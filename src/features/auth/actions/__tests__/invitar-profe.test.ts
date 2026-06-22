import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import { invitarProfeSchema } from '../../schemas/invitation'
import { invitarProfeCore, revocarInvitacionProfeCore } from '../invitar-profe'
import { ok, fail, type ActionResult } from '../types'

/**
 * Tests unitarios de los núcleos de F11-C-1 (invitar/revocar profe). Cliente
 * Supabase falso con cola de respuestas (cada `await` consume la siguiente) +
 * stub inyectable de `sendInvitation`. `calls` registra insert/update.
 */

const AULA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const CENTRO = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
const INV = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'

interface Resp {
  data: unknown
  error: unknown
}
interface Call {
  op: 'insert' | 'update'
  patch: unknown
}

function makeFake(responses: Resp[]) {
  const calls: Call[] = []
  let i = 0
  const next = (): Resp => responses[i++] ?? { data: null, error: null }

  function builder() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {}
    b.select = () => b
    b.eq = () => b
    b.is = () => b
    b.in = () => b
    b.order = () => b
    b.limit = () => b
    b.single = () => b
    b.maybeSingle = () => b
    b.update = (patch: unknown) => {
      calls.push({ op: 'update', patch })
      return b
    }
    b.insert = (patch: unknown) => {
      calls.push({ op: 'insert', patch })
      return b
    }
    b.then = (resolve: (v: Resp) => unknown) => resolve(next())
    return b
  }

  const fake = { from: () => builder() } as unknown as SupabaseClient<Database>
  return { fake, calls }
}

const VALID_INPUT = {
  nombreCompleto: 'Profe Pruebas',
  email: 'profe@example.com',
  aulaId: AULA,
  tipoPersonalAula: 'profesora' as const,
}

function sendStub(result: ActionResult<{ invitationId: string }>) {
  return vi.fn(async () => result)
}

describe('invitarProfeCore', () => {
  it('happy (no coordinadora): deriva centro, llama sendInvitation y persiste nombre+tipo', async () => {
    const { fake, calls } = makeFake([
      { data: { centro_id: CENTRO }, error: null }, // aula
      { data: null, error: null }, // update invitaciones
    ])
    const send = sendStub(ok({ invitationId: INV }))
    const r = await invitarProfeCore(
      { serviceClient: fake, sendInvitationFn: send },
      VALID_INPUT,
      'es'
    )

    expect(r.success).toBe(true)
    if (r.success) expect(r.data.invitationId).toBe(INV)
    expect(send).toHaveBeenCalledWith(
      { email: 'profe@example.com', rolObjetivo: 'profe', centroId: CENTRO, aulaId: AULA },
      'es'
    )
    expect(calls[0]?.op).toBe('update')
    expect(calls[0]?.patch).toMatchObject({
      nombre_completo: 'Profe Pruebas',
      tipo_personal_aula: 'profesora',
    })
  })

  it('coordinadora libre: valida y crea la invitación', async () => {
    const { fake } = makeFake([
      { data: { centro_id: CENTRO }, error: null }, // aula
      { data: null, error: null }, // coordinadora activa? no
      { data: null, error: null }, // update
    ])
    const send = sendStub(ok({ invitationId: INV }))
    const r = await invitarProfeCore(
      { serviceClient: fake, sendInvitationFn: send },
      { ...VALID_INPUT, tipoPersonalAula: 'coordinadora' },
      'es'
    )
    expect(r.success).toBe(true)
    expect(send).toHaveBeenCalledOnce()
  })

  it('coordinadora ocupada: NO crea la invitación (decisión E)', async () => {
    const { fake } = makeFake([
      { data: { centro_id: CENTRO }, error: null }, // aula
      { data: { id: 'existente' }, error: null }, // ya hay coordinadora activa
    ])
    const send = sendStub(ok({ invitationId: INV }))
    const r = await invitarProfeCore(
      { serviceClient: fake, sendInvitationFn: send },
      { ...VALID_INPUT, tipoPersonalAula: 'coordinadora' },
      'es'
    )
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('auth.invitation.errors.coordinadora_ocupada')
    expect(send).not.toHaveBeenCalled()
  })

  it('aula inexistente: falla sin llamar a sendInvitation', async () => {
    const { fake } = makeFake([{ data: null, error: null }])
    const send = sendStub(ok({ invitationId: INV }))
    const r = await invitarProfeCore(
      { serviceClient: fake, sendInvitationFn: send },
      VALID_INPUT,
      'es'
    )
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('aula.errors.no_encontrada')
    expect(send).not.toHaveBeenCalled()
  })

  it('propaga el fallo de sendInvitation (p. ej. no es admin)', async () => {
    const { fake, calls } = makeFake([{ data: { centro_id: CENTRO }, error: null }])
    const send = sendStub(fail('auth.invitation.errors.forbidden'))
    const r = await invitarProfeCore(
      { serviceClient: fake, sendInvitationFn: send },
      VALID_INPUT,
      'es'
    )
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('auth.invitation.errors.forbidden')
    expect(calls.length).toBe(0) // no update
  })

  it('error al persistir nombre/tipo → update_failed', async () => {
    const { fake } = makeFake([
      { data: { centro_id: CENTRO }, error: null }, // aula
      { data: null, error: { message: 'boom' } }, // update falla
    ])
    const send = sendStub(ok({ invitationId: INV }))
    const r = await invitarProfeCore(
      { serviceClient: fake, sendInvitationFn: send },
      VALID_INPUT,
      'es'
    )
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('auth.invitation.errors.update_failed')
  })

  it('input inválido: falla por schema sin tocar la BD', async () => {
    const { fake, calls } = makeFake([])
    const send = sendStub(ok({ invitationId: INV }))
    const r = await invitarProfeCore(
      { serviceClient: fake, sendInvitationFn: send },
      { ...VALID_INPUT, email: 'no-es-email' },
      'es'
    )
    expect(r.success).toBe(false)
    expect(send).not.toHaveBeenCalled()
    expect(calls.length).toBe(0)
  })
})

describe('revocarInvitacionProfeCore', () => {
  const pendiente = {
    id: INV,
    centro_id: CENTRO,
    rol_objetivo: 'profe',
    accepted_at: null,
    rejected_at: null,
  }

  it('admin del centro: marca rejected_at', async () => {
    const { fake, calls } = makeFake([
      { data: pendiente, error: null },
      { data: null, error: null },
    ])
    const r = await revocarInvitacionProfeCore(fake, INV, () => true)
    expect(r.success).toBe(true)
    expect(calls[0]?.op).toBe('update')
    expect(calls[0]?.patch).toHaveProperty('rejected_at')
  })

  it('no admin del centro: forbidden, sin update', async () => {
    const { fake, calls } = makeFake([{ data: pendiente, error: null }])
    const r = await revocarInvitacionProfeCore(fake, INV, () => false)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('auth.invitation.errors.forbidden')
    expect(calls.length).toBe(0)
  })

  it('invitación que no es de profe: invalid', async () => {
    const { fake } = makeFake([
      { data: { ...pendiente, rol_objetivo: 'tutor_legal' }, error: null },
    ])
    const r = await revocarInvitacionProfeCore(fake, INV, () => true)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('auth.invitation.errors.invalid')
  })

  it('ya aceptada: invalid', async () => {
    const { fake } = makeFake([
      { data: { ...pendiente, accepted_at: '2026-01-01T00:00:00Z' }, error: null },
    ])
    const r = await revocarInvitacionProfeCore(fake, INV, () => true)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('auth.invitation.errors.invalid')
  })

  it('inexistente: invalid', async () => {
    const { fake } = makeFake([{ data: null, error: null }])
    const r = await revocarInvitacionProfeCore(fake, INV, () => true)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('auth.invitation.errors.invalid')
  })
})

describe('invitarProfeSchema', () => {
  it('acepta un input válido', () => {
    expect(invitarProfeSchema.safeParse(VALID_INPUT).success).toBe(true)
  })

  it('rechaza email inválido', () => {
    expect(invitarProfeSchema.safeParse({ ...VALID_INPUT, email: 'x' }).success).toBe(false)
  })

  it('rechaza tipo_personal_aula fuera del ENUM', () => {
    expect(
      invitarProfeSchema.safeParse({ ...VALID_INPUT, tipoPersonalAula: 'director' }).success
    ).toBe(false)
  })

  it('rechaza nombre demasiado corto', () => {
    expect(invitarProfeSchema.safeParse({ ...VALID_INPUT, nombreCompleto: 'A' }).success).toBe(
      false
    )
  })

  it('rechaza aulaId no-uuid', () => {
    expect(invitarProfeSchema.safeParse({ ...VALID_INPUT, aulaId: 'nope' }).success).toBe(false)
  })
})
