import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

describe('RLS centros — aislamiento entre centros', () => {
  let centroA: { id: string; nombre: string }
  let centroB: { id: string; nombre: string }
  let adminA: TestUser

  beforeAll(async () => {
    centroA = await createTestCentro('Centro A RLS')
    centroB = await createTestCentro('Centro B RLS')
    adminA = await createTestUser({ nombre: 'Admin A' })
    await asignarRol(adminA.id, centroA.id, 'admin')
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('roles_usuario').delete().eq('usuario_id', adminA.id)
    await deleteTestUser(adminA.id)
    await deleteTestCentro(centroA.id)
    await deleteTestCentro(centroB.id)
  }, 60_000)

  it('admin de centro A solo ve su propio centro', async () => {
    const client = await clientFor(adminA)
    const { data, error } = await client.from('centros').select('id, nombre')
    expect(error).toBeNull()
    expect(data).toBeDefined()
    const ids = (data ?? []).map((c) => c.id)
    expect(ids).toContain(centroA.id)
    expect(ids).not.toContain(centroB.id)
  })

  it('admin de centro A no puede UPDATE el centro B', async () => {
    const client = await clientFor(adminA)
    const { error } = await client
      .from('centros')
      .update({ nombre: 'Hackeado' })
      .eq('id', centroB.id)
    // RLS filtra silenciosamente: no error, pero el row no se modifica.
    // Verificamos que el nombre original siga intacto via service role.
    expect(error).toBeNull()
    const { data: serviceData } = await serviceClient
      .from('centros')
      .select('nombre')
      .eq('id', centroB.id)
      .single()
    expect(serviceData?.nombre).toBe('Centro B RLS')
  })
})
