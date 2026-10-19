import { randomUUID } from 'crypto'

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

/**
 * RLS de **Storage** del avatar de usuario (bucket privado `usuarios-fotos`, políticas de
 * 20261019120000). Ruta `{usuarioId}/…`: quién la ve y quién la cambia sale de los centros
 * donde el DUEÑO tiene rol, no de la ruta.
 *  - **escritura**: el dueño sube bajo SU carpeta, no bajo la de otro; un admin sube el de
 *    cualquier usuario con rol en SU centro (también si ese usuario tiene rol en otros), pero
 *    no el de quien no tiene rol en ninguno de sus centros.
 *  - **lectura**: el dueño y el staff (admin/profe) de un centro del dueño; nadie más.
 *  - la ruta vieja `{centroId}/{usuarioId}/…` queda cerrada.
 */

const BUCKET = 'usuarios-fotos'
// Bytes mínimos (el bucket valida el contentType declarado, no el binario).
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const DENEGADO = /row-level security|unauthorized|403/i

describe('RLS Storage — avatar con prefijo del usuario', () => {
  let centro1: { id: string }
  let centro2: { id: string }
  let admin1: TestUser // admin de centro1
  let admin2: TestUser // admin de centro2
  let profe1: TestUser // profe de centro1
  let userA: TestUser // tutor en centro1
  let userB: TestUser // tutor en centro1
  let userM: TestUser // tutor en centro1 Y en centro2

  const creados: { bucket: string; path: string }[] = []

  beforeAll(async () => {
    centro1 = await createTestCentro('Centro Avatar 1')
    centro2 = await createTestCentro('Centro Avatar 2')

    admin1 = await createTestUser({ nombre: 'Admin1 Avatar' })
    admin2 = await createTestUser({ nombre: 'Admin2 Avatar' })
    profe1 = await createTestUser({ nombre: 'Profe1 Avatar' })
    userA = await createTestUser({ nombre: 'Usuario A Avatar' })
    userB = await createTestUser({ nombre: 'Usuario B Avatar' })
    userM = await createTestUser({ nombre: 'Usuario M Avatar' })
    await asignarRol(admin1.id, centro1.id, 'admin')
    await asignarRol(admin2.id, centro2.id, 'admin')
    await asignarRol(profe1.id, centro1.id, 'profe')
    await asignarRol(userA.id, centro1.id, 'tutor_legal')
    await asignarRol(userB.id, centro1.id, 'tutor_legal')
    await asignarRol(userM.id, centro1.id, 'tutor_legal')
    await asignarRol(userM.id, centro2.id, 'tutor_legal')
  })

  afterAll(async () => {
    for (const o of creados) await serviceClient.storage.from(o.bucket).remove([o.path])
    await deleteTestCentro(centro1.id)
    await deleteTestCentro(centro2.id)
    for (const u of [admin1, admin2, profe1, userA, userB, userM]) await deleteTestUser(u.id)
  })

  async function subir(user: TestUser, path: string) {
    const client = await clientFor(user)
    const res = await client.storage
      .from(BUCKET)
      .upload(path, JPG, { contentType: 'image/jpeg', upsert: true })
    if (!res.error) creados.push({ bucket: BUCKET, path })
    return res
  }

  async function firmar(user: TestUser, path: string) {
    const client = await clientFor(user)
    return client.storage.from(BUCKET).createSignedUrl(path, 60)
  }

  it('premisa: los roles de los fixtures están puestos', async () => {
    const { data } = await serviceClient
      .from('roles_usuario')
      .select('usuario_id, centro_id, rol')
      .in('centro_id', [centro1.id, centro2.id])
      .is('deleted_at', null)
    const filas = (data ?? []).map((r) => `${r.usuario_id}:${r.centro_id}:${r.rol}`)
    expect(filas).toEqual(
      expect.arrayContaining([
        `${admin2.id}:${centro2.id}:admin`,
        `${userM.id}:${centro2.id}:tutor_legal`,
        `${userA.id}:${centro1.id}:tutor_legal`,
      ])
    )
    expect(filas).not.toContain(`${userA.id}:${centro2.id}:tutor_legal`)
  })

  it('el dueño sube su avatar bajo {usuarioId}', async () => {
    const res = await subir(userA, `${userA.id}/${randomUUID()}.jpg`)
    expect(res.error).toBeNull()
  })

  it('el usuario NO puede subir bajo la carpeta de OTRO usuario', async () => {
    const res = await subir(userA, `${userB.id}/${randomUUID()}.jpg`)
    expect(res.error?.message).toMatch(DENEGADO)
  })

  it('la ruta vieja {centroId}/{usuarioId}/… queda cerrada, también para el dueño', async () => {
    const res = await subir(userA, `${centro1.id}/${userA.id}/${randomUUID()}.jpg`)
    expect(res.error?.message).toMatch(DENEGADO)
  })

  it('un admin sube el avatar de un usuario con rol en SU centro', async () => {
    const res = await subir(admin1, `${userB.id}/${randomUUID()}.jpg`)
    expect(res.error).toBeNull()
  })

  it('multicentro: el admin de centro2 sube el de quien tiene rol en centro1 y centro2', async () => {
    const res = await subir(admin2, `${userM.id}/${randomUUID()}.jpg`)
    expect(res.error).toBeNull()
  })

  it('el admin de centro2 NO sube el de quien solo tiene rol en centro1', async () => {
    const res = await subir(admin2, `${userA.id}/${randomUUID()}.jpg`)
    expect(res.error?.message).toMatch(DENEGADO)
  })

  it('lectura: el dueño y el staff de su centro firman; otro usuario y un admin ajeno, no', async () => {
    const path = `${userA.id}/${randomUUID()}.jpg`
    const subida = await subir(userA, path)
    expect(subida.error).toBeNull()

    const propio = await firmar(userA, path)
    expect(propio.data?.signedUrl).toBeTruthy()
    const profe = await firmar(profe1, path)
    expect(profe.data?.signedUrl).toBeTruthy()
    const admin = await firmar(admin1, path)
    expect(admin.data?.signedUrl).toBeTruthy()

    const otroTutor = await firmar(userB, path)
    expect(otroTutor.data?.signedUrl).toBeFalsy()
    const adminAjeno = await firmar(admin2, path)
    expect(adminAjeno.data?.signedUrl).toBeFalsy()
  })

  it('lectura multicentro: el admin de centro2 firma el de quien también tiene rol allí', async () => {
    const path = `${userM.id}/${randomUUID()}.jpg`
    const subida = await subir(userM, path)
    expect(subida.error).toBeNull()

    const res = await firmar(admin2, path)
    expect(res.data?.signedUrl).toBeTruthy()
  })
})
