import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { acceptInvitationSchema } from '../../schemas/invitation'
import { acceptPendingInvitationCore } from '../accept-invitation'

/**
 * Tests del núcleo B8 (`acceptPendingInvitationCore`, F11-C-2): un usuario que YA
 * tiene cuenta (p. ej. también es tutor) acepta una invitación de profe y queda
 * vinculado a su aula vía `profes_aulas`, sin crear otra cuenta (decisión F). Cubre
 * también el 23505 de coordinadora. Cliente service-role falso con cola de
 * respuestas (cada `await` consume la siguiente) + usuario de sesión inyectado;
 * `calls` registra inserts/updates por tabla.
 */

const USER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
const CENTRO = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
const AULA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const INV = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'

interface Resp {
  data: unknown
  error: unknown
}
interface Call {
  table: string
  op: 'insert' | 'update'
  patch: unknown
}

function makeFake(responses: Resp[]) {
  const calls: Call[] = []
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
    b.then = (resolve: (v: Resp) => unknown) => {
      // F11-H: la lookup de `aulas` (centro_id para resolver el curso activo en
      // crearVinculoProfeAula) no consume la cola posicional de respuestas.
      if (table === 'aulas') return resolve({ data: { centro_id: CENTRO }, error: null })
      return resolve(next())
    }
    return b
  }

  const fake = {
    from: (table: string) => builder(table),
    // F11-H: curso activo del centro del aula (siempre presente en estos tests).
    rpc: (_fn: string, _args: unknown) => Promise.resolve({ data: 'curso-1', error: null }),
  } as unknown as SupabaseClient<Database>
  return { fake, calls }
}

const profeInvitation = {
  id: INV,
  email: 'profe@example.com',
  rol_objetivo: 'profe',
  centro_id: CENTRO,
  nino_id: null,
  aula_id: AULA,
  tipo_personal_aula: 'profesora',
  tipo_vinculo: null,
  expires_at: '2999-01-01T00:00:00Z',
  accepted_at: null,
  rejected_at: null,
}

const sessionUser = { id: USER, email: 'profe@example.com' }

describe('acceptPendingInvitationCore — B8-profe', () => {
  it('tutor existente acepta como profe: inserta rol profe + profes_aulas con el tipo de la invitación', async () => {
    const { fake, calls } = makeFake([
      { data: profeInvitation, error: null }, // invitación
      { data: null, error: null }, // insert rol profe
      { data: null, error: null }, // insert profes_aulas
      { data: null, error: null }, // update accepted_at
    ])
    const r = await acceptPendingInvitationCore({ serviceClient: fake, user: sessionUser }, INV)

    expect(r.success).toBe(true)
    if (r.success) expect(r.data.rol).toBe('profe')

    const rol = calls.find((c) => c.table === 'roles_usuario')
    expect(rol?.patch).toMatchObject({ usuario_id: USER, centro_id: CENTRO, rol: 'profe' })

    const link = calls.find((c) => c.table === 'profes_aulas')
    expect(link?.patch).toMatchObject({
      profe_id: USER,
      aula_id: AULA,
      tipo_personal_aula: 'profesora',
    })

    // Se marca aceptada (update sobre invitaciones tras el vínculo).
    expect(calls.some((c) => c.table === 'invitaciones' && c.op === 'update')).toBe(true)
  })

  it('coordinadora: persiste el tipo coordinadora en el vínculo', async () => {
    const { fake, calls } = makeFake([
      { data: { ...profeInvitation, tipo_personal_aula: 'coordinadora' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: null },
    ])
    const r = await acceptPendingInvitationCore({ serviceClient: fake, user: sessionUser }, INV)
    expect(r.success).toBe(true)
    const link = calls.find((c) => c.table === 'profes_aulas')
    expect(link?.patch).toMatchObject({ tipo_personal_aula: 'coordinadora' })
  })

  it('23505 de coordinadora: mensaje amable y NO marca accepted_at', async () => {
    const { fake, calls } = makeFake([
      { data: { ...profeInvitation, tipo_personal_aula: 'coordinadora' }, error: null },
      { data: null, error: null }, // rol profe ok
      { data: null, error: { code: '23505', message: 'dup' } }, // profes_aulas colisiona
    ])
    const r = await acceptPendingInvitationCore({ serviceClient: fake, user: sessionUser }, INV)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('auth.invitation.errors.coordinadora_ocupada')
    // No se llegó a marcar la invitación como aceptada (reintentable vía B8).
    expect(calls.some((c) => c.table === 'invitaciones' && c.op === 'update')).toBe(false)
  })

  it('email de la invitación distinto al de sesión → email_mismatch', async () => {
    const { fake } = makeFake([{ data: profeInvitation, error: null }])
    const r = await acceptPendingInvitationCore(
      { serviceClient: fake, user: { id: USER, email: 'otro@example.com' } },
      INV
    )
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('auth.invitation.errors.email_mismatch')
  })

  it('invitación ya aceptada → invalid', async () => {
    const { fake } = makeFake([
      { data: { ...profeInvitation, accepted_at: '2026-01-01T00:00:00Z' }, error: null },
    ])
    const r = await acceptPendingInvitationCore({ serviceClient: fake, user: sessionUser }, INV)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('auth.invitation.errors.invalid')
  })
})

describe('accept: la foto es OPCIONAL (decisión D, F11-C-3)', () => {
  // El avatar NO forma parte del contrato del accept: se sube por una route handler
  // aparte TRAS crear la cuenta. Por eso un alta sin foto valida sin más y nada en el
  // schema puede bloquear el alta por ausencia de imagen.
  const baseInput = {
    token: '11111111-1111-4111-8111-111111111111',
    nombreCompleto: 'Profe Pruebas',
    password: 'Una-Clave-Larga-2026!',
    idiomaPreferido: 'es' as const,
    aceptaTerminos: true as const,
    aceptaPrivacidad: true as const,
  }

  it('el schema de accept parsea sin foto', () => {
    expect(acceptInvitationSchema.safeParse(baseInput).success).toBe(true)
  })

  it('el alta sin foto produce un objeto válido sin campo de imagen', () => {
    const parsed = acceptInvitationSchema.parse(baseInput)
    expect('foto' in parsed).toBe(false)
    expect('avatar' in parsed).toBe(false)
  })
})
