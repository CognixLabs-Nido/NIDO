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

describe('RLS audit_log — append-only (UPDATE/DELETE bloqueados)', () => {
  let centro: { id: string }
  let admin: TestUser
  let auditRowId: string

  beforeAll(async () => {
    centro = await createTestCentro('Centro Audit RLS')
    admin = await createTestUser({ nombre: 'Admin Audit' })
    await asignarRol(admin.id, centro.id, 'admin')

    // El INSERT en roles_usuario disparó un audit_log via trigger.
    // Buscamos esa fila por centro_id (el trigger sí captura centro_id aunque
    // usuario_id sea NULL cuando el insert se hace con service role sin sesión).
    const { data, error } = await serviceClient
      .from('audit_log')
      .select('id')
      .eq('centro_id', centro.id)
      .eq('tabla', 'roles_usuario')
      .order('ts', { ascending: false })
      .limit(1)
    if (error || !data?.length) {
      throw new Error(`No se encontró fila audit_log inicial: ${error?.message}`)
    }
    auditRowId = data[0].id
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('roles_usuario').delete().eq('usuario_id', admin.id)
    await deleteTestUser(admin.id)
    await deleteTestCentro(centro.id)
    // audit_log queda con filas históricas — no las borramos para honrar la
    // semántica append-only. El centro de test no afecta a otros tests.
  }, 60_000)

  it('admin puede SELECT audit_log de su centro', async () => {
    const client = await clientFor(admin)
    const { data, error } = await client
      .from('audit_log')
      .select('id, tabla, accion')
      .eq('centro_id', centro.id)
    expect(error).toBeNull()
    expect((data ?? []).length).toBeGreaterThanOrEqual(1)
  })

  it('admin NO puede UPDATE audit_log (RLS deny-all)', async () => {
    const client = await clientFor(admin)
    const { error, data } = await client
      .from('audit_log')
      .update({ accion: 'DELETE' })
      .eq('id', auditRowId)
      .select()
    // Patrón Supabase: el UPDATE se filtra silenciosamente — devuelve 0 filas modificadas, sin error.
    // Verificamos que la fila no haya cambiado vía service role.
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
    const { data: serviceCheck } = await serviceClient
      .from('audit_log')
      .select('accion')
      .eq('id', auditRowId)
      .single()
    expect(serviceCheck?.accion).not.toBe('DELETE')
  })

  it('admin NO puede DELETE audit_log', async () => {
    const client = await clientFor(admin)
    const { error, data } = await client.from('audit_log').delete().eq('id', auditRowId).select()
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
    // La fila debe seguir existiendo.
    const { data: serviceCheck } = await serviceClient
      .from('audit_log')
      .select('id')
      .eq('id', auditRowId)
      .maybeSingle()
    expect(serviceCheck?.id).toBe(auditRowId)
  })
})
