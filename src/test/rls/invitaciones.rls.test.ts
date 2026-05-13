import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  clientFor,
  createTestCentro,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestCentro,
  type TestUser,
} from './setup'

describe('RLS — public.invitaciones', () => {
  let regularUser: TestUser
  let centro: TestCentro
  let invitationId: string

  beforeAll(async () => {
    centro = await createTestCentro('Centro Invitaciones RLS')
    regularUser = await createTestUser({ nombre: 'Sin rol admin' })
    const { data, error } = await serviceClient
      .from('invitaciones')
      .insert({
        email: 'invitado-rls@nido.test',
        rol_objetivo: 'tutor_legal',
        centro_id: centro.id,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`setup invitaciones falló: ${error?.message}`)
    invitationId = data.id
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('invitaciones').delete().eq('id', invitationId)
    await deleteTestUser(regularUser.id)
    await deleteTestCentro(centro.id)
  }, 30_000)

  it('un usuario sin rol admin no puede leer invitaciones del centro', async () => {
    const client = await clientFor(regularUser)
    const { data, error } = await client
      .from('invitaciones')
      .select('id')
      .eq('centro_id', centro.id)

    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})
