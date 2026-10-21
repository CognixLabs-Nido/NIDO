import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { rolesDeAutores } from '@/features/centros/contexto/roles-de-otros'
import {
  centrosDondeEsAdmin,
  esAdminEn,
  esResponsableEn,
  leerCentrosDe,
  rolesEnCualquierCentro,
} from '@/features/centros/contexto/roles-del-usuario'
import { requiredRolesFor } from '@/proxy-roles'

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

/**
 * PR 3 del modelo de roles — cómo lee la app a una directora, con SU sesión contra la BD (la RLS
 * de `roles_usuario` delante, como en producción). La directora es Dirección en su centro
 * (`rol: 'admin'`, como `es_admin`) sin ser la responsable (`es_responsable`); la admin, las dos
 * cosas. El proxy ve la fila tal cual (`directora`) y la deja entrar en `/admin`.
 */
describe('la app lee a la directora con su sesión', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let directora: TestUser
  let admin: TestUser

  beforeAll(async () => {
    centroA = await createTestCentro('Centro Directora App A')
    centroB = await createTestCentro('Centro Directora App B')
    directora = await createTestUser({ nombre: 'Directora App' })
    admin = await createTestUser({ nombre: 'Admin App' })
    await asignarRol(directora.id, centroA.id, 'directora')
    await asignarRol(directora.id, centroB.id, 'profe')
    await asignarRol(admin.id, centroA.id, 'admin')
  })

  afterAll(async () => {
    for (const u of [directora, admin]) if (u) await deleteTestUser(u.id)
    for (const c of [centroA, centroB]) if (c) await deleteTestCentro(c.id)
  })

  it('premisa: con su sesión lee su fila de directora en A', async () => {
    const c = await clientFor(directora)
    const { data, error } = await c
      .from('roles_usuario')
      .select('centro_id, rol')
      .eq('usuario_id', directora.id)
      .is('deleted_at', null)
    expect(error).toBeNull()
    expect(data).toEqual(
      expect.arrayContaining([
        { centro_id: centroA.id, rol: 'directora' },
        { centro_id: centroB.id, rol: 'profe' },
      ])
    )
  })

  it('leerCentrosDe: Dirección en A sin ser responsable, profe en B', async () => {
    const c = await clientFor(directora)
    const centros = await leerCentrosDe(c, directora.id)
    expect(centros?.find((x) => x.centroId === centroA.id)).toEqual({
      centroId: centroA.id,
      rol: 'admin',
      roles: ['admin'],
      esResponsable: false,
    })
    expect(centros?.find((x) => x.centroId === centroB.id)).toEqual({
      centroId: centroB.id,
      rol: 'profe',
      roles: ['profe'],
      esResponsable: false,
    })
  })

  it('esAdminEn (Dirección) sí en A; esResponsableEn no. La admin, las dos', async () => {
    const cd = await clientFor(directora)
    expect(await esAdminEn(cd, directora.id, centroA.id)).toBe(true)
    expect(await esResponsableEn(cd, directora.id, centroA.id)).toBe(false)
    expect(await esAdminEn(cd, directora.id, centroB.id)).toBe(false)
    expect(await centrosDondeEsAdmin(cd, directora.id)).toEqual([centroA.id])

    const ca = await clientFor(admin)
    expect(await esAdminEn(ca, admin.id, centroA.id)).toBe(true)
    expect(await esResponsableEn(ca, admin.id, centroA.id)).toBe(true)
  })

  it('el proxy: su fila es directora, y /admin y /teacher la dejan pasar; /family no', async () => {
    const c = await clientFor(directora)
    const roles = await rolesEnCualquierCentro(c, directora.id)
    expect(roles).toContain('directora')
    const entra = (ruta: string) => roles.some((r) => requiredRolesFor(ruta)?.includes(r))
    expect(entra('/admin/cursos')).toBe(true)
    expect(entra('/teacher/aula/x')).toBe(true)
    expect(entra('/family')).toBe(false)
  })

  it('rolesDeAutores: la directora sale como admin (Dirección en la etiqueta del mensaje)', async () => {
    const c = await clientFor(admin)
    const filas = await rolesDeAutores(c, [directora.id], centroA.id)
    expect(filas).toEqual([{ usuario_id: directora.id, rol: 'admin' }])
  })

  it('rolesDeAutores: en el otro centro sale con su rol de allí (profe), no como Dirección', async () => {
    // Premisa: la directora de A es profe en B, y con service role se ven sus dos filas.
    const { data: todas } = await serviceClient
      .from('roles_usuario')
      .select('centro_id, rol')
      .eq('usuario_id', directora.id)
      .is('deleted_at', null)
    expect((todas ?? []).map((r) => r.rol).sort()).toEqual(['directora', 'profe'])
    const filas = await rolesDeAutores(serviceClient, [directora.id], centroB.id)
    expect(filas).toEqual([{ usuario_id: directora.id, rol: 'profe' }])
  })
})
