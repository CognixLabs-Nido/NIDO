import { randomUUID } from 'crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { clientFor, createTestUser, deleteTestUser, serviceClient, type TestUser } from './setup'

describe('RLS — public.roles_usuario', () => {
  let userA: TestUser
  let userB: TestUser
  const centroId = randomUUID()

  beforeAll(async () => {
    userA = await createTestUser({ nombre: 'Roles A' })
    userB = await createTestUser({ nombre: 'Roles B' })
    // Insertamos roles via service para evitar la barrera RLS al setup.
    await serviceClient.from('roles_usuario').insert([
      { usuario_id: userA.id, centro_id: centroId, rol: 'tutor_legal' },
      { usuario_id: userB.id, centro_id: centroId, rol: 'profe' },
    ])
  }, 60_000)

  afterAll(async () => {
    await serviceClient
      .from('roles_usuario')
      .delete()
      .or(`usuario_id.eq.${userA.id},usuario_id.eq.${userB.id}`)
    await deleteTestUser(userA.id)
    await deleteTestUser(userB.id)
  }, 30_000)

  it('un usuario puede leer sus propios roles', async () => {
    const client = await clientFor(userA)
    const { data, error } = await client
      .from('roles_usuario')
      .select('rol')
      .eq('usuario_id', userA.id)

    expect(error).toBeNull()
    expect(data?.map((r) => r.rol)).toContain('tutor_legal')
  })

  it('un usuario NO puede leer roles ajenos', async () => {
    const client = await clientFor(userA)
    const { data, error } = await client
      .from('roles_usuario')
      .select('rol')
      .eq('usuario_id', userB.id)

    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})
