import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { centrosDelUsuario, resolverCentroActivo } from '@/features/centros/contexto/resolver'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  type TestUser,
} from './setup'

/**
 * Multicentro · Fase 1 — lo que el contexto de centro da por hecho en la BD, con un usuario que
 * tiene roles en DOS centros (admin en A, tutora en B) y un tercer centro C que no es suyo.
 *
 * `get-contexto-centro.ts` lee los roles del usuario con SU sesión (`roles_self_select`) y el
 * selector pone nombre a los centros con `centros_select_miembros`. Si la RLS no devolviera los
 * dos centros, el usuario no vería el selector; si devolviera C, podría elegir un centro ajeno.
 */
describe('multi-centro — contexto de centro con un usuario en dos centros', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let centroC: { id: string }
  let usuario: TestUser
  let otroDeA: TestUser

  beforeAll(async () => {
    centroA = await createTestCentro('Centro Ctx A')
    centroB = await createTestCentro('Centro Ctx B')
    centroC = await createTestCentro('Centro Ctx C')
    usuario = await createTestUser({ nombre: 'Usuaria Dos Centros' })
    await asignarRol(usuario.id, centroA.id, 'admin')
    await asignarRol(usuario.id, centroB.id, 'tutor_legal')
    otroDeA = await createTestUser({ nombre: 'Profe Ctx A' })
    await asignarRol(otroDeA.id, centroA.id, 'profe')
  })

  afterAll(async () => {
    for (const u of [usuario, otroDeA]) if (u) await deleteTestUser(u.id)
    for (const c of [centroA, centroB, centroC]) if (c) await deleteTestCentro(c.id)
  })

  it('sus roles, con su sesión: los dos centros, y el resolver pide elegir', async () => {
    const c = await clientFor(usuario)
    const { data, error } = await c
      .from('roles_usuario')
      .select('centro_id, rol')
      .eq('usuario_id', usuario.id)
      .is('deleted_at', null)
    expect(error).toBeNull()
    const centros = centrosDelUsuario(data ?? [])
    expect(centros.map((x) => x.centroId).sort()).toEqual([centroA.id, centroB.id].sort())
    expect(centros.find((x) => x.centroId === centroA.id)?.rol).toBe('admin')
    expect(centros.find((x) => x.centroId === centroB.id)?.rol).toBe('tutor_legal')

    expect(resolverCentroActivo(centros, undefined).tipo).toBe('elegir')
    expect(resolverCentroActivo(centros, centroC.id).tipo).toBe('elegir')
    expect(resolverCentroActivo(centros, centroB.id)).toMatchObject({
      tipo: 'activo',
      centro: { centroId: centroB.id, rol: 'tutor_legal' },
    })
  })

  it('sin filtrar por usuario, como admin de A vería roles AJENOS: por eso el contexto filtra', async () => {
    const c = await clientFor(usuario)
    const { data } = await c.from('roles_usuario').select('usuario_id, centro_id')
    expect((data ?? []).some((r) => r.usuario_id === otroDeA.id)).toBe(true)
  })

  it('nombres de centros para el selector: A y B, nunca C', async () => {
    const c = await clientFor(usuario)
    const { data, error } = await c
      .from('centros')
      .select('id, nombre')
      .in('id', [centroA.id, centroB.id, centroC.id])
    expect(error).toBeNull()
    expect((data ?? []).map((x) => x.id).sort()).toEqual([centroA.id, centroB.id].sort())
  })
})
