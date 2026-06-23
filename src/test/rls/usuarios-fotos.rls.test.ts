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
 * RLS de **Storage** del avatar de usuario (F11-C-3, bucket privado `usuarios-fotos`,
 * políticas de F11-C-0). Verifica el aislamiento sobre `storage.objects`
 * (`{centroId}/{usuarioId}/…`):
 *  - **escritura**: el propio usuario sube bajo SU carpeta (`[2]=usuarioId`), NO bajo la
 *    de otro; dirección sube bajo cualquier usuario de SU centro, pero NO fuera de él.
 *  - **lectura**: el propio usuario firma su avatar; un usuario sin rol staff del centro
 *    no firma el de otro.
 *
 * **Gated** por `F11C0_MIGRATION_APPLIED=1` (bucket + políticas aplicados a mano por SQL
 * Editor — CLI SIGILL). Comando:
 *   F11C0_MIGRATION_APPLIED=1 npm run test:rls -- usuarios-fotos.rls
 */
const MIGRATION_APPLIED = process.env.F11C0_MIGRATION_APPLIED === '1'

const BUCKET = 'usuarios-fotos'
// Bytes mínimos (el bucket valida el contentType declarado, no el binario).
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

describe.skipIf(!MIGRATION_APPLIED)(
  'RLS Storage — F11-C-3 (avatar: self vs ajeno vs admin)',
  () => {
    let centro1: { id: string }
    let centro2: { id: string }
    let admin: TestUser
    let userA: TestUser
    let userB: TestUser

    const creados: { bucket: string; path: string }[] = []

    beforeAll(async () => {
      centro1 = await createTestCentro('Centro Avatar 1')
      centro2 = await createTestCentro('Centro Avatar 2')

      admin = await createTestUser({ nombre: 'Admin Avatar' })
      userA = await createTestUser({ nombre: 'Usuario A Avatar' })
      userB = await createTestUser({ nombre: 'Usuario B Avatar' })
      await asignarRol(admin.id, centro1.id, 'admin')
      await asignarRol(userA.id, centro1.id, 'tutor_legal')
      await asignarRol(userB.id, centro1.id, 'tutor_legal')
    })

    afterAll(async () => {
      for (const o of creados) await serviceClient.storage.from(o.bucket).remove([o.path])
      await deleteTestCentro(centro1.id)
      await deleteTestCentro(centro2.id)
      for (const u of [admin, userA, userB]) await deleteTestUser(u.id)
    })

    async function subir(user: TestUser, path: string) {
      const client = await clientFor(user)
      const res = await client.storage
        .from(BUCKET)
        .upload(path, JPG, { contentType: 'image/jpeg', upsert: true })
      if (!res.error) creados.push({ bucket: BUCKET, path })
      return res
    }

    it('el propio usuario sube su avatar (bajo su {usuarioId})', async () => {
      const res = await subir(userA, `${centro1.id}/${userA.id}/${randomUUID()}.jpg`)
      expect(res.error).toBeNull()
    })

    it('el usuario NO puede subir bajo la carpeta de OTRO usuario', async () => {
      const res = await subir(userA, `${centro1.id}/${userB.id}/${randomUUID()}.jpg`)
      expect(res.error).not.toBeNull()
    })

    it('dirección sube el avatar de cualquier usuario de SU centro', async () => {
      const res = await subir(admin, `${centro1.id}/${userB.id}/${randomUUID()}.jpg`)
      expect(res.error).toBeNull()
    })

    it('dirección NO puede subir bajo un centro donde no es admin', async () => {
      const res = await subir(admin, `${centro2.id}/${userB.id}/${randomUUID()}.jpg`)
      expect(res.error).not.toBeNull()
    })

    it('lectura: el usuario firma su avatar; otro (no staff) NO firma el ajeno', async () => {
      const path = `${centro1.id}/${userA.id}/${randomUUID()}.jpg`
      await subir(userA, path)

      const cA = await clientFor(userA)
      const propio = await cA.storage.from(BUCKET).createSignedUrl(path, 60)
      expect(propio.error).toBeNull()
      expect(propio.data?.signedUrl).toBeTruthy()

      const cB = await clientFor(userB)
      const ajeno = await cB.storage.from(BUCKET).createSignedUrl(path, 60)
      expect(ajeno.data?.signedUrl).toBeFalsy()
    })
  }
)
