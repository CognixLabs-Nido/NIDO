import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  clientFor,
  createTestUser,
  deleteTestUser,
  expectLecturaAnonDenegada,
  serviceClient,
  type TestUser,
} from './setup'

describe('RLS — public.usuarios', () => {
  let userA: TestUser
  let userB: TestUser

  beforeAll(async () => {
    userA = await createTestUser({ nombre: 'Usuario A' })
    userB = await createTestUser({ nombre: 'Usuario B' })
    // El trigger handle_new_user ya insertó las filas en public.usuarios.
  }, 30_000)

  afterAll(async () => {
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  }, 30_000)

  it('un usuario puede leer su propia fila', async () => {
    const client = await clientFor(userA)
    const { data, error } = await client
      .from('usuarios')
      .select('id, nombre_completo')
      .eq('id', userA.id)
      .maybeSingle()

    expect(error).toBeNull()
    expect(data?.id).toBe(userA.id)
    expect(data?.nombre_completo).toBe('Usuario A')
  })

  it('un usuario NO puede leer la fila de otro usuario', async () => {
    const client = await clientFor(userA)
    const { data, error } = await client
      .from('usuarios')
      .select('id')
      .eq('id', userB.id)
      .maybeSingle()

    // RLS oculta la fila → data null y sin error (no 403).
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('un usuario no autenticado no puede listar usuarios', async () => {
    const { data, error } = await serviceClient.auth.signOut().then(async () => {
      const { anonClient } = await import('./setup')
      const c = anonClient()
      return c.from('usuarios').select('id').limit(10)
    })

    // Sin sesión: desde 20261010140000 anon no tiene SELECT de tabla (42501); antes, las policies
    // no le dejaban ver ninguna fila (lista vacía).
    expectLecturaAnonDenegada({ data, error }, 'usuarios')
  })
})
