import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import { detectarCuentaPorEmail } from '../detectar-cuenta-email'

/**
 * `detectarCuentaPorEmail` (página `/invitation/[token]`). Cliente Supabase falso: la RPC
 * `buscar_auth_user_por_email` y la lectura de `roles_usuario` devuelven lo que diga cada
 * caso, y `llamadas` registra qué se pidió para afirmar que la búsqueda va por la RPC exacta
 * y NO por `auth.admin.listUsers` (que no se define: si se llamara, el test reventaría).
 */

const CUENTA = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', email: 'tutor@correo.test' }

interface Resp {
  data: unknown
  error: unknown
}

function makeFake(rpc: Resp, roles: Resp = { data: [], error: null }) {
  const llamadas: string[] = []
  const thenable = (r: Resp) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {}
    b.select = () => b
    b.eq = () => b
    b.is = () => b
    b.limit = () => b
    b.maybeSingle = () => b
    b.then = (ok: (v: Resp) => unknown) => Promise.resolve(r).then(ok)
    return b
  }
  const client = {
    rpc: (nombre: string, args: { p_email: string }) => {
      llamadas.push(`rpc:${nombre}:${args.p_email}`)
      return thenable(rpc)
    },
    from: (tabla: string) => {
      llamadas.push(`from:${tabla}`)
      return thenable(roles)
    },
  }
  return { client: client as unknown as SupabaseClient<Database>, llamadas }
}

describe('detectarCuentaPorEmail', () => {
  it('busca por la RPC exacta con el email de la invitación, no por listUsers', async () => {
    const { client, llamadas } = makeFake({ data: null, error: null })
    await detectarCuentaPorEmail(client, CUENTA.email)
    expect(llamadas[0]).toBe(`rpc:buscar_auth_user_por_email:${CUENTA.email}`)
  })

  it('sin cuenta: no existe y no se leen roles', async () => {
    const { client, llamadas } = makeFake({ data: null, error: null })
    expect(await detectarCuentaPorEmail(client, CUENTA.email)).toEqual({
      authUserExiste: false,
      tieneRoles: false,
    })
    expect(llamadas).not.toContain('from:roles_usuario')
  })

  it('cuenta stub (sin roles): existe y no tiene roles', async () => {
    const { client } = makeFake({ data: CUENTA, error: null }, { data: [], error: null })
    expect(await detectarCuentaPorEmail(client, CUENTA.email)).toEqual({
      authUserExiste: true,
      tieneRoles: false,
    })
  })

  it('cuenta real (con roles): existe y tiene roles', async () => {
    const { client } = makeFake(
      { data: CUENTA, error: null },
      { data: [{ usuario_id: CUENTA.id }], error: null }
    )
    expect(await detectarCuentaPorEmail(client, CUENTA.email)).toEqual({
      authUserExiste: true,
      tieneRoles: true,
    })
  })

  it('si falla la RPC devuelve null: no se supone que la cuenta no existe', async () => {
    const { client } = makeFake({ data: null, error: { message: 'timeout' } })
    expect(await detectarCuentaPorEmail(client, CUENTA.email)).toBeNull()
  })

  it('si falla la lectura de roles devuelve null', async () => {
    const { client } = makeFake(
      { data: CUENTA, error: null },
      { data: null, error: { message: 'timeout' } }
    )
    expect(await detectarCuentaPorEmail(client, CUENTA.email)).toBeNull()
  })
})
