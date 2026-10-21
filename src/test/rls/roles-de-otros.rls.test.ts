import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRolDeInvitacion,
  retirarRolesDeCuentaNueva,
} from '@/features/centros/contexto/escribir-roles'
import {
  contarRolesDelCentro,
  profesDelCentro,
  profesDelCentroConNombre,
  rolesDeAutores,
  rolesDelSujetoParaExport,
  tieneRolesVivos,
  tieneRolFamiliarEn,
  tieneRolProfeEn,
} from '@/features/centros/contexto/roles-de-otros'
import { rolesEnCualquierCentro } from '@/features/centros/contexto/roles-del-usuario'

import {
  asignarRol,
  createTestCentro,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * Multicentro · Fase 1 · PR6 — las funciones con nombre que sustituyen a las lecturas sueltas de
 * `roles_usuario`, contra la BD: cada una filtra lo que dice su nombre (centro, rol, roles
 * borrados). Con service role, porque varias se usan así; el filtro es lo que se prueba.
 */
describe('roles de otros usuarios — funciones del módulo de contexto', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let profeA: TestUser // profe en A
  let autorizadoA: TestUser // autorizado en A
  let tutorB: TestUser // tutor legal en B
  let borrado: TestUser // profe en A, con el rol borrado
  let sinRoles: TestUser

  beforeAll(async () => {
    centroA = await createTestCentro('Centro Roles Otros A')
    centroB = await createTestCentro('Centro Roles Otros B')
    profeA = await createTestUser({ nombre: 'Profe Roles A' })
    autorizadoA = await createTestUser({ nombre: 'Autorizado Roles A' })
    tutorB = await createTestUser({ nombre: 'Tutor Roles B' })
    borrado = await createTestUser({ nombre: 'Profe Borrado A' })
    sinRoles = await createTestUser({ nombre: 'Sin Roles' })
    await asignarRol(profeA.id, centroA.id, 'profe')
    await asignarRol(autorizadoA.id, centroA.id, 'autorizado')
    await asignarRol(tutorB.id, centroB.id, 'tutor_legal')
    await asignarRol(borrado.id, centroA.id, 'profe')
    const { error } = await serviceClient
      .from('roles_usuario')
      .update({ deleted_at: new Date().toISOString(), deleted_reason: 'revocacion_familia' })
      .eq('usuario_id', borrado.id)
    if (error) throw new Error(`borrar rol: ${error.message}`)
  })

  afterAll(async () => {
    for (const u of [profeA, autorizadoA, tutorB, borrado, sinRoles])
      if (u) await deleteTestUser(u.id)
    for (const c of [centroA, centroB]) if (c) await deleteTestCentro(c.id)
  })

  it('premisa: los roles de los fixtures están como se espera', async () => {
    const { data } = await serviceClient
      .from('roles_usuario')
      .select('usuario_id, centro_id, rol, deleted_at')
      .in('centro_id', [centroA.id, centroB.id])
    const filas = (data ?? []).map(
      (r) => `${r.usuario_id}:${r.centro_id}:${r.rol}:${r.deleted_at ? 'borrado' : 'vivo'}`
    )
    expect(filas.sort()).toEqual(
      [
        `${profeA.id}:${centroA.id}:profe:vivo`,
        `${autorizadoA.id}:${centroA.id}:autorizado:vivo`,
        `${tutorB.id}:${centroB.id}:tutor_legal:vivo`,
        `${borrado.id}:${centroA.id}:profe:borrado`,
      ].sort()
    )
  })

  it('tieneRolesVivos: con rol sí; sin roles o con el rol borrado, no', async () => {
    expect(await tieneRolesVivos(serviceClient, profeA.id)).toBe(true)
    expect(await tieneRolesVivos(serviceClient, sinRoles.id)).toBe(false)
    expect(await tieneRolesVivos(serviceClient, borrado.id)).toBe(false)
  })

  it('tieneRolProfeEn: solo en su centro, solo profe y solo vivo', async () => {
    expect(await tieneRolProfeEn(serviceClient, profeA.id, centroA.id)).toBe(true)
    expect(await tieneRolProfeEn(serviceClient, profeA.id, centroB.id)).toBe(false)
    expect(await tieneRolProfeEn(serviceClient, autorizadoA.id, centroA.id)).toBe(false)
    expect(await tieneRolProfeEn(serviceClient, borrado.id, centroA.id)).toBe(false)
  })

  it('tieneRolFamiliarEn: tutor o autorizado de ese centro; un profe no', async () => {
    expect(await tieneRolFamiliarEn(serviceClient, tutorB.id, centroB.id)).toBe(true)
    expect(await tieneRolFamiliarEn(serviceClient, tutorB.id, centroA.id)).toBe(false)
    expect(await tieneRolFamiliarEn(serviceClient, autorizadoA.id, centroA.id)).toBe(true)
    expect(await tieneRolFamiliarEn(serviceClient, profeA.id, centroA.id)).toBe(false)
  })

  it('contarRolesDelCentro y los profes del centro: sin roles borrados ni de otro centro', async () => {
    expect(await contarRolesDelCentro(serviceClient, centroA.id)).toBe(2)
    expect(await profesDelCentro(serviceClient, centroA.id)).toEqual([profeA.id])
    const { data, error } = await profesDelCentroConNombre(serviceClient, centroA.id)
    expect(error).toBeNull()
    expect((data ?? []).map((r) => r.usuario?.id)).toEqual([profeA.id])
  })

  it('rolesDeAutores: los vivos de esos usuarios en ese centro; sin autores, nada', async () => {
    const autores = [profeA.id, tutorB.id, borrado.id]
    const enA = await rolesDeAutores(serviceClient, autores, centroA.id)
    expect(enA.map((r) => `${r.usuario_id}:${r.rol}`)).toEqual([`${profeA.id}:profe`])
    const enB = await rolesDeAutores(serviceClient, autores, centroB.id)
    expect(enB.map((r) => `${r.usuario_id}:${r.rol}`)).toEqual([`${tutorB.id}:tutor_legal`])
    expect(await rolesDeAutores(serviceClient, [], centroA.id)).toEqual([])
  })

  it('rolesDelSujetoParaExport: también los borrados (el export los incluye)', async () => {
    const filas = await rolesDelSujetoParaExport(serviceClient, borrado.id)
    expect(filas).toHaveLength(1)
    expect(filas[0]?.deleted_at).not.toBeNull()
  })

  it('rolesEnCualquierCentro: los roles vivos del usuario, sin el centro', async () => {
    expect(await rolesEnCualquierCentro(serviceClient, profeA.id)).toEqual(['profe'])
    expect(await rolesEnCualquierCentro(serviceClient, borrado.id)).toEqual([])
  })

  it('escribir-roles: asignar el rol de la invitación y retirarlo de la cuenta nueva', async () => {
    const { error } = await asignarRolDeInvitacion(serviceClient, {
      usuario_id: sinRoles.id,
      centro_id: centroB.id,
      rol: 'autorizado',
    })
    expect(error).toBeNull()
    expect(await tieneRolesVivos(serviceClient, sinRoles.id)).toBe(true)

    await retirarRolesDeCuentaNueva(serviceClient, sinRoles.id)
    expect(await tieneRolesVivos(serviceClient, sinRoles.id)).toBe(false)
  })
})
