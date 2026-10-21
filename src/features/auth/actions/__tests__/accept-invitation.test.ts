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
 * `calls` registra inserts/updates por tabla y las RPC que dan el rol y los vínculos
 * (`rpc:<nombre>`, con sus argumentos). Esas RPC no consumen la cola: responden lo que
 * diga `rpcs` (por defecto, sin error).
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
  op: 'insert' | 'update' | 'upsert' | 'rpc'
  patch: unknown
}

type Rpcs = Record<string, (args: Record<string, unknown>) => Resp>

/** Lo que escribe: inserts/updates/upserts y las RPC que dan rol o vínculo sin `p_solo_comprobar`. */
function escrituras(calls: Call[]) {
  return calls.filter(
    (c) => c.op !== 'rpc' || !(c.patch as Record<string, unknown> | undefined)?.p_solo_comprobar
  )
}

/** El 55000 con el que la BD dice que una fila retirada no vuelve por una invitación. */
const noVuelve = (motivo: string) => () => ({
  data: null,
  error: { code: '55000', message: `retirada por ${motivo}`, hint: motivo },
})

function makeFake(responses: Resp[], rpcs: Rpcs = {}) {
  const calls: Call[] = []
  let i = 0
  const next = (): Resp => responses[i++] ?? { data: null, error: null }

  function builder(table: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {}
    b.select = () => b
    b.eq = () => b
    b.is = () => b
    b.in = () => b
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
    b.upsert = (patch: unknown) => {
      calls.push({ table, op: 'upsert', patch })
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
    rpc: (fn: string, args: Record<string, unknown>) => {
      if (fn === 'dar_rol_de_invitacion' || fn === 'dar_vinculos_de_invitacion') {
        calls.push({ table: `rpc:${fn}`, op: 'rpc', patch: args })
        return Promise.resolve(rpcs[fn]?.(args) ?? { data: null, error: null })
      }
      // F11-H: curso activo del centro del aula (siempre presente en estos tests).
      return Promise.resolve({ data: 'curso-1', error: null })
    },
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
      { data: null, error: null }, // insert profes_aulas
      { data: null, error: null }, // update accepted_at
    ])
    const r = await acceptPendingInvitationCore({ serviceClient: fake, user: sessionUser }, INV)

    expect(r.success).toBe(true)
    if (r.success) expect(r.data.rol).toBe('profe')

    // El rol, por la RPC de la tabla de motivos: primero se mira sin escribir, luego se da.
    const rol = calls.filter((c) => c.table === 'rpc:dar_rol_de_invitacion').map((c) => c.patch)
    expect(rol).toEqual([
      { p_usuario_id: USER, p_centro_id: CENTRO, p_rol: 'profe', p_solo_comprobar: true },
      { p_usuario_id: USER, p_centro_id: CENTRO, p_rol: 'profe' },
    ])

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
    ])
    const r = await acceptPendingInvitationCore({ serviceClient: fake, user: sessionUser }, INV)
    expect(r.success).toBe(true)
    const link = calls.find((c) => c.table === 'profes_aulas')
    expect(link?.patch).toMatchObject({ tipo_personal_aula: 'coordinadora' })
  })

  it('23505 de coordinadora: mensaje amable y NO marca accepted_at', async () => {
    const { fake, calls } = makeFake([
      { data: { ...profeInvitation, tipo_personal_aula: 'coordinadora' }, error: null },
      { data: null, error: { code: '23505', message: 'dup' } }, // profes_aulas colisiona
    ])
    const r = await acceptPendingInvitationCore({ serviceClient: fake, user: sessionUser }, INV)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBe('auth.invitation.errors.coordinadora_ocupada')
    // No se llegó a marcar la invitación como aceptada (reintentable vía B8).
    expect(calls.some((c) => c.table === 'invitaciones' && c.op === 'update')).toBe(false)
  })

  it('de baja temporal en el centro: no entra sin rol; mensaje claro y no toca nada', async () => {
    const { fake, calls } = makeFake([{ data: profeInvitation, error: null }], {
      dar_rol_de_invitacion: noVuelve('baja_temporal'),
    })
    const r = await acceptPendingInvitationCore({ serviceClient: fake, user: sessionUser }, INV)
    expect(r).toEqual({ success: false, error: 'auth.invitation.errors.acceso_en_pausa' })
    expect(escrituras(calls)).toEqual([])
  })

  it('con el olvido en curso: no entra; mensaje claro y no toca nada', async () => {
    const { fake, calls } = makeFake([{ data: profeInvitation, error: null }], {
      dar_rol_de_invitacion: noVuelve('solicitud_olvido'),
    })
    const r = await acceptPendingInvitationCore({ serviceClient: fake, user: sessionUser }, INV)
    expect(r).toEqual({ success: false, error: 'auth.invitation.errors.acceso_olvido' })
    expect(escrituras(calls)).toEqual([])
  })

  it('la comprobación falla por otra cosa: no sigue (role_failed) y no toca nada', async () => {
    const { fake, calls } = makeFake([{ data: profeInvitation, error: null }], {
      dar_rol_de_invitacion: () => ({ data: null, error: { code: '08006', message: 'caída' } }),
    })
    const r = await acceptPendingInvitationCore({ serviceClient: fake, user: sessionUser }, INV)
    expect(r).toEqual({ success: false, error: 'auth.invitation.errors.role_failed' })
    expect(escrituras(calls)).toEqual([])
  })

  it('un error al dar el rol no se ignora: no marca la invitación', async () => {
    const { fake, calls } = makeFake([{ data: profeInvitation, error: null }], {
      dar_rol_de_invitacion: (args) =>
        args.p_solo_comprobar
          ? { data: 'crear', error: null }
          : { data: null, error: { code: '23505', message: 'duplicate key value' } },
    })
    const r = await acceptPendingInvitationCore({ serviceClient: fake, user: sessionUser }, INV)
    expect(r).toEqual({ success: false, error: 'auth.invitation.errors.role_failed' })
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

describe('acceptPendingInvitationCore — alta del 2.º hijo (B8)', () => {
  const NINO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  const HERMANO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
  const tutor2Invitation = {
    ...profeInvitation,
    email: 'tutor2@example.com',
    rol_objetivo: 'tutor_legal',
    nino_id: NINO,
    aula_id: null,
    tipo_personal_aula: null,
    tipo_vinculo: 'tutor_legal_secundario',
  }
  const tutor2 = { id: USER, email: 'tutor2@example.com' }

  it('el 2.º tutor queda vinculado como secundario a todos los hijos de la familia', async () => {
    const { fake, calls } = makeFake([
      { data: tutor2Invitation, error: null }, // invitación
      // Los niños a vincular se resuelven antes de tocar nada (se comprueban sus vínculos).
      { data: { familia_id: 'fam-1' }, error: null }, // familia del niño
      { data: [{ id: NINO }, { id: HERMANO }], error: null }, // hijos de la familia
      // PR 1 (Fase 4): antes del rol, su perfil de la familia se enlaza a la cuenta.
      { data: { familia_id: 'fam-1' }, error: null }, // familia del niño
      {
        data: [
          { id: 'ft-1', email: 'titular@example.com', usuario_id: 'otro-tutor' },
          { id: 'ft-2', email: 'Tutor2@Example.com', usuario_id: null },
        ],
        error: null,
      }, // perfiles de la familia
      { data: { nombre_completo: 'Tutor Dos' }, error: null }, // nombre de su cuenta
      { data: { id: 'ft-2' }, error: null }, // update familia_tutores
      { data: null, error: null }, // update accepted_at
    ])
    const r = await acceptPendingInvitationCore({ serviceClient: fake, user: tutor2 }, INV, {
      parentesco: 'padre',
    })

    expect(r.success).toBe(true)
    const perfil = calls.find((c) => c.table === 'familia_tutores' && c.op === 'update')
    expect(perfil?.patch).toEqual({ usuario_id: USER, nombre_completo: 'Tutor Dos' })
    const vinc = calls.filter((c) => c.table === 'rpc:dar_vinculos_de_invitacion')
    expect(vinc.map((c) => (c.patch as Record<string, unknown>).p_solo_comprobar)).toEqual([
      true,
      false,
    ])
    expect(vinc[1]?.patch).toMatchObject({
      p_usuario_id: USER,
      p_nino_ids: [NINO, HERMANO],
      p_tipo: 'tutor_legal_secundario',
      p_parentesco: 'padre',
    })
  })

  it('sin su perfil pendiente en la familia, no sigue: ni rol ni vínculo (PR 1)', async () => {
    const { fake, calls } = makeFake([
      { data: tutor2Invitation, error: null }, // invitación
      { data: { familia_id: 'fam-1' }, error: null }, // familia del niño
      { data: [{ id: NINO }], error: null }, // hijos de la familia
      { data: { familia_id: 'fam-1' }, error: null }, // familia del niño
      {
        data: [{ id: 'ft-1', email: 'titular@example.com', usuario_id: 'otro-tutor' }],
        error: null,
      }, // perfiles: ninguno con su email
    ])
    const r = await acceptPendingInvitationCore({ serviceClient: fake, user: tutor2 }, INV, {
      parentesco: 'padre',
    })

    expect(r).toEqual({ success: false, error: 'auth.invitation.errors.vinculo_failed' })
    expect(escrituras(calls)).toEqual([])
  })

  it('si su perfil ya estaba enlazado (aceptación a medias), no lo toca y sigue (PR 1)', async () => {
    const { fake, calls } = makeFake([
      { data: tutor2Invitation, error: null }, // invitación
      { data: { familia_id: 'fam-1' }, error: null }, // familia del niño
      { data: [{ id: NINO }], error: null }, // hijos de la familia
      { data: { familia_id: 'fam-1' }, error: null }, // familia del niño
      { data: [{ id: 'ft-2', email: 'tutor2@example.com', usuario_id: USER }], error: null },
      { data: null, error: null }, // update accepted_at
    ])
    const r = await acceptPendingInvitationCore({ serviceClient: fake, user: tutor2 }, INV, {
      parentesco: 'padre',
    })

    expect(r.success).toBe(true)
    expect(calls.some((c) => c.table === 'familia_tutores')).toBe(false)
  })

  it('un autorizado solo queda vinculado al niño de su invitación', async () => {
    const { fake, calls } = makeFake([
      {
        data: { ...tutor2Invitation, rol_objetivo: 'autorizado', tipo_vinculo: 'autorizado' },
        error: null,
      },
      { data: null, error: null }, // update accepted_at
    ])
    const r = await acceptPendingInvitationCore({ serviceClient: fake, user: tutor2 }, INV, {
      parentesco: 'abuela',
    })

    expect(r.success).toBe(true)
    const vinc = calls.filter((c) => c.table === 'rpc:dar_vinculos_de_invitacion')
    expect(vinc[1]?.patch).toMatchObject({ p_nino_ids: [NINO], p_tipo: 'autorizado' })
  })

  it('un vínculo retirado que no vuelve: se para antes de tocar nada, con su mensaje', async () => {
    const { fake, calls } = makeFake(
      [
        { data: tutor2Invitation, error: null }, // invitación
        { data: { familia_id: 'fam-1' }, error: null }, // familia del niño
        { data: [{ id: NINO }], error: null }, // hijos de la familia
      ],
      { dar_vinculos_de_invitacion: noVuelve('solicitud_olvido') }
    )
    const r = await acceptPendingInvitationCore({ serviceClient: fake, user: tutor2 }, INV, {
      parentesco: 'padre',
    })

    expect(r).toEqual({ success: false, error: 'auth.invitation.errors.acceso_olvido' })
    expect(escrituras(calls)).toEqual([])
  })

  it('el vínculo falla al darlo: no marca la invitación (antes, un upsert mudo la dejaba sin vínculo)', async () => {
    const { fake, calls } = makeFake(
      [
        {
          data: { ...tutor2Invitation, rol_objetivo: 'autorizado', tipo_vinculo: 'autorizado' },
          error: null,
        },
      ],
      {
        dar_vinculos_de_invitacion: (args) =>
          args.p_solo_comprobar
            ? { data: null, error: null }
            : { data: null, error: { code: '23505', message: 'duplicate key value' } },
      }
    )
    const r = await acceptPendingInvitationCore({ serviceClient: fake, user: tutor2 }, INV, {
      parentesco: 'abuela',
    })

    expect(r).toEqual({ success: false, error: 'auth.invitation.errors.vinculo_failed' })
    expect(calls.some((c) => c.table === 'invitaciones' && c.op === 'update')).toBe(false)
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
