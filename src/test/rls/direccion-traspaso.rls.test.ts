import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { asignarRolDeInvitacion } from '@/features/centros/contexto/escribir-roles'

import {
  anonClient,
  asignarRol,
  clientFor,
  createTestCentro,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * PR 4 del modelo de roles — `traspasar_admin` y `baja_de_direccion` (`20261031130000`).
 *
 * El traspaso es atómico: la saliente deja de ser admin y queda como directora, y la entrante
 * pasa de directora a admin, en una transacción; con el índice de una admin viva por centro no
 * hay otra forma. Cada «no» comprueba que nada cambió (la admin sigue siéndolo), no solo el
 * error. Los tests de un mismo `describe` van en orden: el estado de uno es el del siguiente.
 */

type Rol = 'admin' | 'directora' | 'profe'

/** Las filas de Dirección o profe de un usuario en un centro: rol → { viva, motivo }. */
async function filas(usuarioId: string, centroId: string) {
  const { data, error } = await serviceClient
    .from('roles_usuario')
    .select('rol, deleted_at, deleted_reason')
    .eq('usuario_id', usuarioId)
    .eq('centro_id', centroId)
  if (error) throw new Error(error.message)
  return Object.fromEntries(
    (data ?? []).map((f) => [f.rol, { viva: f.deleted_at === null, motivo: f.deleted_reason }])
  ) as Partial<Record<Rol, { viva: boolean; motivo: string | null }>>
}

async function vivos(usuarioId: string, centroId: string): Promise<Rol[]> {
  const f = await filas(usuarioId, centroId)
  return (Object.keys(f) as Rol[]).filter((r) => f[r]?.viva).sort()
}

async function adminsVivas(centroId: string): Promise<number> {
  const { count } = await serviceClient
    .from('roles_usuario')
    .select('id', { count: 'exact', head: true })
    .eq('centro_id', centroId)
    .eq('rol', 'admin')
    .is('deleted_at', null)
  return count ?? -1
}

describe('traspasar_admin y baja_de_direccion', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let admin: TestUser
  let dir1: TestUser
  let dir2: TestUser
  let profe: TestUser
  let adminB: TestUser
  let dirB: TestUser

  beforeAll(async () => {
    centroA = await createTestCentro('Centro Traspaso A')
    centroB = await createTestCentro('Centro Traspaso B')
    admin = await createTestUser({ nombre: 'Admin Traspaso' })
    dir1 = await createTestUser({ nombre: 'Directora Uno' })
    dir2 = await createTestUser({ nombre: 'Directora Dos' })
    profe = await createTestUser({ nombre: 'Profe Traspaso' })
    adminB = await createTestUser({ nombre: 'Admin Traspaso B' })
    dirB = await createTestUser({ nombre: 'Directora B' })
    await asignarRol(admin.id, centroA.id, 'admin')
    await asignarRol(dir1.id, centroA.id, 'directora')
    await asignarRol(dir2.id, centroA.id, 'directora')
    await asignarRol(profe.id, centroA.id, 'profe')
    await asignarRol(adminB.id, centroB.id, 'admin')
    await asignarRol(dirB.id, centroB.id, 'directora')
  })

  afterAll(async () => {
    for (const u of [admin, dir1, dir2, profe, adminB, dirB]) if (u) await deleteTestUser(u.id)
    for (const c of [centroA, centroB]) if (c) await deleteTestCentro(c.id)
  })

  it('premisa: una admin y dos directoras en A, una profe; B con su admin y su directora', async () => {
    expect(await vivos(admin.id, centroA.id)).toEqual(['admin'])
    expect(await vivos(dir1.id, centroA.id)).toEqual(['directora'])
    expect(await vivos(dir2.id, centroA.id)).toEqual(['directora'])
    expect(await vivos(profe.id, centroA.id)).toEqual(['profe'])
    expect(await adminsVivas(centroA.id)).toBe(1)
  })

  describe('el traspaso', () => {
    it('una directora no traspasa (42501), y la admin sigue siéndolo', async () => {
      const c = await clientFor(dir2)
      const { error } = await c.rpc('traspasar_admin', {
        p_centro_id: centroA.id,
        p_nueva_admin: dir1.id,
      })
      expect(error?.code).toBe('42501')
      expect(await vivos(admin.id, centroA.id)).toEqual(['admin'])
      expect(await vivos(dir1.id, centroA.id)).toEqual(['directora'])
    })

    it('la admin no traspasa a una profe (23514): no cambia nada', async () => {
      const c = await clientFor(admin)
      const { error } = await c.rpc('traspasar_admin', {
        p_centro_id: centroA.id,
        p_nueva_admin: profe.id,
      })
      expect(error?.code).toBe('23514')
      expect(await vivos(admin.id, centroA.id)).toEqual(['admin'])
      expect(await vivos(profe.id, centroA.id)).toEqual(['profe'])
    })

    it('ni a una directora de otro centro (23514)', async () => {
      const c = await clientFor(admin)
      const { error } = await c.rpc('traspasar_admin', {
        p_centro_id: centroA.id,
        p_nueva_admin: dirB.id,
      })
      expect(error?.code).toBe('23514')
      expect(await vivos(admin.id, centroA.id)).toEqual(['admin'])
      expect(await vivos(dirB.id, centroA.id)).toEqual([])
    })

    it('ni a sí misma (22023)', async () => {
      const c = await clientFor(admin)
      const { error } = await c.rpc('traspasar_admin', {
        p_centro_id: centroA.id,
        p_nueva_admin: admin.id,
      })
      expect(error?.code).toBe('22023')
      expect(await vivos(admin.id, centroA.id)).toEqual(['admin'])
    })

    it('la admin de otro centro no traspasa la de A (42501)', async () => {
      const c = await clientFor(adminB)
      const { error } = await c.rpc('traspasar_admin', {
        p_centro_id: centroA.id,
        p_nueva_admin: dir1.id,
      })
      expect(error?.code).toBe('42501')
      expect(await vivos(admin.id, centroA.id)).toEqual(['admin'])
    })

    it('la admin traspasa a una directora: la entrante es admin y la saliente, directora', async () => {
      const c = await clientFor(admin)
      const { error } = await c.rpc('traspasar_admin', {
        p_centro_id: centroA.id,
        p_nueva_admin: dir1.id,
      })
      expect(error).toBeNull()
      expect(await vivos(dir1.id, centroA.id)).toEqual(['admin'])
      expect(await vivos(admin.id, centroA.id)).toEqual(['directora'])
      expect(await adminsVivas(centroA.id)).toBe(1)
      expect((await filas(admin.id, centroA.id)).admin).toEqual({
        viva: false,
        motivo: 'traspaso_admin',
      })
      expect((await filas(dir1.id, centroA.id)).directora).toEqual({
        viva: false,
        motivo: 'traspaso_admin',
      })
      // El otro centro no se toca.
      expect(await vivos(adminB.id, centroB.id)).toEqual(['admin'])
    })

    it('la saliente ya no traspasa: no tiene la fila de admin (42501)', async () => {
      const c = await clientFor(admin)
      const { error } = await c.rpc('traspasar_admin', {
        p_centro_id: centroA.id,
        p_nueva_admin: dir2.id,
      })
      expect(error?.code).toBe('42501')
      expect(await vivos(dir1.id, centroA.id)).toEqual(['admin'])
    })

    it('y de vuelta: reactiva las filas retiradas en vez de chocar con la unicidad', async () => {
      const c = await clientFor(dir1)
      const { error } = await c.rpc('traspasar_admin', {
        p_centro_id: centroA.id,
        p_nueva_admin: admin.id,
      })
      expect(error).toBeNull()
      expect(await vivos(admin.id, centroA.id)).toEqual(['admin'])
      expect(await vivos(dir1.id, centroA.id)).toEqual(['directora'])
      expect(await adminsVivas(centroA.id)).toBe(1)
      // Una fila por (usuario, centro, rol): la de antes, reactivada.
      const { count } = await serviceClient
        .from('roles_usuario')
        .select('id', { count: 'exact', head: true })
        .eq('usuario_id', admin.id)
        .eq('centro_id', centroA.id)
      expect(count).toBe(2)
    })
  })

  describe('la baja de Dirección', () => {
    it('una directora no da de baja a otra (42501)', async () => {
      const c = await clientFor(dir1)
      const { error } = await c.rpc('baja_de_direccion', {
        p_centro_id: centroA.id,
        p_usuario_id: dir2.id,
      })
      expect(error?.code).toBe('42501')
      expect(await vivos(dir2.id, centroA.id)).toEqual(['directora'])
    })

    it('la admin de otro centro tampoco (42501)', async () => {
      const c = await clientFor(adminB)
      const { error } = await c.rpc('baja_de_direccion', {
        p_centro_id: centroA.id,
        p_usuario_id: dir2.id,
      })
      expect(error?.code).toBe('42501')
      expect(await vivos(dir2.id, centroA.id)).toEqual(['directora'])
    })

    it('la admin no se da de baja: primero traspasa (55000), y sigue siendo admin', async () => {
      const c = await clientFor(admin)
      const { error } = await c.rpc('baja_de_direccion', {
        p_centro_id: centroA.id,
        p_usuario_id: admin.id,
      })
      expect(error?.code).toBe('55000')
      expect(await vivos(admin.id, centroA.id)).toEqual(['admin'])
    })

    it('a una profe no la da de baja por aquí (P0002): no es directora', async () => {
      const c = await clientFor(admin)
      const { error } = await c.rpc('baja_de_direccion', {
        p_centro_id: centroA.id,
        p_usuario_id: profe.id,
      })
      expect(error?.code).toBe('P0002')
      expect(await vivos(profe.id, centroA.id)).toEqual(['profe'])
    })

    it('la admin da de baja a una directora', async () => {
      const c = await clientFor(admin)
      const { error } = await c.rpc('baja_de_direccion', {
        p_centro_id: centroA.id,
        p_usuario_id: dir2.id,
      })
      expect(error).toBeNull()
      expect((await filas(dir2.id, centroA.id)).directora).toEqual({
        viva: false,
        motivo: 'baja_direccion',
      })
    })

    it('una directora se da de baja ella misma', async () => {
      const c = await clientFor(dir1)
      const { error } = await c.rpc('baja_de_direccion', {
        p_centro_id: centroA.id,
        p_usuario_id: dir1.id,
      })
      expect(error).toBeNull()
      expect((await filas(dir1.id, centroA.id)).directora).toEqual({
        viva: false,
        motivo: 'baja_direccion',
      })
    })

    it('anon no ejecuta ninguna de las dos', async () => {
      const a = anonClient()
      const t = await a.rpc('traspasar_admin', { p_centro_id: centroA.id, p_nueva_admin: dir2.id })
      const b = await a.rpc('baja_de_direccion', { p_centro_id: centroA.id, p_usuario_id: dir2.id })
      expect(t.error?.code).toBe('42501')
      expect(b.error?.code).toBe('42501')
    })
  })

  describe('la invitación de quien dejó la dirección', () => {
    it('reactiva su fila de directora (sin esto, entraba sin rol)', async () => {
      // Premisa: dir2 dejó la dirección (test anterior) y su fila sigue retirada.
      expect((await filas(dir2.id, centroA.id)).directora?.viva).toBe(false)
      const { error } = await asignarRolDeInvitacion(serviceClient, {
        usuario_id: dir2.id,
        centro_id: centroA.id,
        rol: 'directora',
      })
      expect(error).toBeNull()
      expect(await vivos(dir2.id, centroA.id)).toEqual(['directora'])
    })

    it('una baja por otro motivo no se deshace: devuelve el 23505, como antes', async () => {
      await serviceClient
        .from('roles_usuario')
        .update({ deleted_at: new Date().toISOString(), deleted_reason: 'revocacion_familia' })
        .eq('usuario_id', profe.id)
        .eq('centro_id', centroA.id)
        .eq('rol', 'profe')
      const { error } = await asignarRolDeInvitacion(serviceClient, {
        usuario_id: profe.id,
        centro_id: centroA.id,
        rol: 'profe',
      })
      expect(error?.code).toBe('23505')
      expect(await vivos(profe.id, centroA.id)).toEqual([])
    })
  })
})
