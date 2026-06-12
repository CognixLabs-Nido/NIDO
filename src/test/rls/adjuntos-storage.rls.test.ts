import { randomUUID } from 'crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * RLS de **Storage** para los adjuntos de F10-3 (migración
 * `20260613100000_phase10_3_adjuntos_storage_policies`). Verifica el aislamiento entre
 * familias en la escritura sobre `storage.objects`:
 *  - **ninos-fotos**: el tutor sube la foto de SU hijo (`{centro}/{ninoSuyo}/…`), NO la
 *    de otra familia; dirección sube la de cualquier niño (F10-0).
 *  - **recogida-adjuntos**: el tutor sube/lee la foto del DNI de SU recogida; NO la de
 *    otro niño.
 *  - **centro-assets** (logo, público): solo dirección escribe; el tutor NO.
 *
 * **Gated** por `F10_3_MIGRATION_APPLIED=1` (la migración se aplica a mano por SQL
 * Editor — CLI SIGILL). Comando:
 *   F10_3_MIGRATION_APPLIED=1 npm run test:rls -- adjuntos-storage.rls
 */
const MIGRATION_APPLIED = process.env.F10_3_MIGRATION_APPLIED === '1'

// Bytes mínimos (el contentType declarado es lo que valida el bucket, no el binario).
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe.skipIf(!MIGRATION_APPLIED)('RLS Storage — F10-3 (adjuntos: tutor vs ajeno)', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let admin: TestUser
  let tutorA: TestUser
  let tutorB: TestUser
  let ninoA: { id: string }
  let ninoB: { id: string }

  // Objetos subidos en cada bucket, para limpiar al final.
  const creados: { bucket: string; path: string }[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro Adjuntos')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id, 'Aula Adj')

    admin = await createTestUser({ nombre: 'Admin Adj' })
    tutorA = await createTestUser({ nombre: 'Tutor A Adj' })
    tutorB = await createTestUser({ nombre: 'Tutor B Adj' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(tutorA.id, centro.id, 'tutor_legal')
    await asignarRol(tutorB.id, centro.id, 'tutor_legal')

    ninoA = await createTestNino(centro.id)
    ninoB = await createTestNino(centro.id)
    await matricular(ninoA.id, aula.id, curso.id)
    await matricular(ninoB.id, aula.id, curso.id)
    await crearVinculo(ninoA.id, tutorA.id, 'tutor_legal_principal')
    await crearVinculo(ninoB.id, tutorB.id, 'tutor_legal_principal')
  })

  afterAll(async () => {
    for (const o of creados) await serviceClient.storage.from(o.bucket).remove([o.path])
    await deleteTestCentro(centro.id)
    for (const u of [admin, tutorA, tutorB]) await deleteTestUser(u.id)
  })

  async function subir(
    user: TestUser,
    bucket: string,
    path: string,
    body: Buffer,
    contentType: string
  ) {
    const client = await clientFor(user)
    const res = await client.storage.from(bucket).upload(path, body, { contentType, upsert: true })
    if (!res.error) creados.push({ bucket, path })
    return res
  }

  // ─── ninos-fotos ───────────────────────────────────────────────────────────
  it('ninos-fotos: el tutor sube la foto de SU hijo', async () => {
    const res = await subir(
      tutorA,
      'ninos-fotos',
      `${centro.id}/${ninoA.id}/${randomUUID()}.jpg`,
      JPG,
      'image/jpeg'
    )
    expect(res.error).toBeNull()
  })

  it('ninos-fotos: el tutor NO puede subir la foto de OTRO niño', async () => {
    const res = await subir(
      tutorA,
      'ninos-fotos',
      `${centro.id}/${ninoB.id}/${randomUUID()}.jpg`,
      JPG,
      'image/jpeg'
    )
    expect(res.error).not.toBeNull()
  })

  it('ninos-fotos: dirección sube la foto de cualquier niño (F10-0)', async () => {
    const res = await subir(
      admin,
      'ninos-fotos',
      `${centro.id}/${ninoB.id}/${randomUUID()}.jpg`,
      JPG,
      'image/jpeg'
    )
    expect(res.error).toBeNull()
  })

  // ─── recogida-adjuntos ──────────────────────────────────────────────────────
  it('recogida-adjuntos: el tutor sube el DNI bajo SU hijo', async () => {
    const res = await subir(
      tutorA,
      'recogida-adjuntos',
      `${centro.id}/${ninoA.id}/${randomUUID()}.jpg`,
      JPG,
      'image/jpeg'
    )
    expect(res.error).toBeNull()
  })

  it('recogida-adjuntos: el tutor NO puede subir bajo OTRO niño', async () => {
    const res = await subir(
      tutorA,
      'recogida-adjuntos',
      `${centro.id}/${ninoB.id}/${randomUUID()}.jpg`,
      JPG,
      'image/jpeg'
    )
    expect(res.error).not.toBeNull()
  })

  it('recogida-adjuntos: el tutor puede firmar (leer) lo suyo y NO lo ajeno', async () => {
    const pathPropio = `${centro.id}/${ninoA.id}/${randomUUID()}.jpg`
    await subir(tutorA, 'recogida-adjuntos', pathPropio, JPG, 'image/jpeg')

    const cA = await clientFor(tutorA)
    const propio = await cA.storage.from('recogida-adjuntos').createSignedUrl(pathPropio, 60)
    expect(propio.error).toBeNull()
    expect(propio.data?.signedUrl).toBeTruthy()

    const cB = await clientFor(tutorB)
    const ajeno = await cB.storage.from('recogida-adjuntos').createSignedUrl(pathPropio, 60)
    expect(ajeno.data?.signedUrl).toBeFalsy()
  })

  // ─── centro-assets (logo, público) ──────────────────────────────────────────
  it('centro-assets: dirección sube el logo; el tutor NO', async () => {
    const ok = await subir(admin, 'centro-assets', `${centro.id}/logo.png`, PNG, 'image/png')
    expect(ok.error).toBeNull()

    const cA = await clientFor(tutorA)
    const denied = await cA.storage
      .from('centro-assets')
      .upload(`${centro.id}/logo.png`, PNG, { contentType: 'image/png', upsert: true })
    expect(denied.error).not.toBeNull()
  })
})
