import { randomUUID } from 'crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { clientFor, createTestUser, deleteTestUser, serviceClient, type TestUser } from './setup'

describe('RLS — public.invitaciones', () => {
  let regularUser: TestUser
  const centroId = randomUUID()
  let invitationId: string

  beforeAll(async () => {
    regularUser = await createTestUser({ nombre: 'Sin rol admin' })
    // Creamos una invitación con service role (no hace falta admin para crearla en setup).
    const { data } = await serviceClient
      .from('invitaciones')
      .insert({
        email: 'invitado-rls@nido.test',
        rol_objetivo: 'tutor_legal',
        centro_id: centroId,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select('id')
      .single()
    invitationId = data!.id
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('invitaciones').delete().eq('id', invitationId)
    await deleteTestUser(regularUser.id)
  }, 30_000)

  it('un usuario sin rol admin no puede leer invitaciones del centro', async () => {
    const client = await clientFor(regularUser)
    const { data, error } = await client.from('invitaciones').select('id').eq('centro_id', centroId)

    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})
