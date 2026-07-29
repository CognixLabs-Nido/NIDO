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
// El gate de consent en la subida del perfil (IU-3) requiere la migración
// `20260821170000`. Hasta aplicarla, el bloqueo por-niño no existe en Storage/RPC.
const IU3_APPLIED = process.env.IMAGEN_IU3_APPLIED === '1'

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
    // IU-3: la escritura en `ninos-fotos` exige consent de imagen del niño ([2]=ninoId).
    // Los casos POSITIVOS de abajo (tutor sube SU foto, dirección sube cualquiera) ya no
    // pasan sin consent → se otorga a ambos. El gate por-niño tiene su propio bloque.
    await otorgarImagen(ninoA.id, tutorA.id)
    await otorgarImagen(ninoB.id, tutorB.id)
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

  // Consent de imagen por-niño (IU-3). service_role salta el guard del RPC; p_tutor solo
  // debe ser un usuario válido. El flag `puede_aparecer_en_fotos` es derivado (IU-1b).
  async function otorgarImagen(nino_id: string, tutor_id: string): Promise<void> {
    const { error } = await serviceClient.rpc('otorgar_consentimiento_imagen', {
      p_nino_id: nino_id,
      p_tutor: tutor_id,
    })
    if (error) throw new Error(`otorgarImagen falló: ${error.message}`)
  }
  async function revocarImagen(nino_id: string): Promise<void> {
    const { error } = await serviceClient.rpc('revocar_consentimiento_imagen', {
      p_nino_id: nino_id,
    })
    if (error) throw new Error(`revocarImagen falló: ${error.message}`)
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

  // ─── IU-3: gate de consent de imagen POR-NIÑO en la subida del perfil ────────
  it.skipIf(!IU3_APPLIED)(
    'ninos-fotos (IU-3): sin consent, ni tutor ni dirección suben; con consent, sí; por-niño',
    async () => {
      // Niño C SIN consent; su hermano D CON consent (misma familia/tutor para aislar el gate).
      const ninoC = await createTestNino(centro.id)
      const ninoD = await createTestNino(centro.id)
      await matricular(ninoC.id, aula.id, curso.id)
      await matricular(ninoD.id, aula.id, curso.id)
      await crearVinculo(ninoC.id, tutorA.id, 'tutor_legal_principal')
      await crearVinculo(ninoD.id, tutorA.id, 'tutor_legal_principal')
      await otorgarImagen(ninoD.id, tutorA.id) // D sí; C no

      // C sin consent → tutor BLOQUEADO.
      const tutorC = await subir(
        tutorA,
        'ninos-fotos',
        `${centro.id}/${ninoC.id}/${randomUUID()}.jpg`,
        JPG,
        'image/jpeg'
      )
      expect(tutorC.error).not.toBeNull()

      // C sin consent → dirección también BLOQUEADA (gate por-niño, no por-rol).
      const adminC = await subir(
        admin,
        'ninos-fotos',
        `${centro.id}/${ninoC.id}/${randomUUID()}.jpg`,
        JPG,
        'image/jpeg'
      )
      expect(adminC.error).not.toBeNull()

      // El hermano D CON consent NO se ve afectado por que C no lo tenga.
      const okD = await subir(
        tutorA,
        'ninos-fotos',
        `${centro.id}/${ninoD.id}/${randomUUID()}.jpg`,
        JPG,
        'image/jpeg'
      )
      expect(okD.error).toBeNull()

      // Al otorgar consent a C, ya se permite; al revocarlo, vuelve a bloquear.
      await otorgarImagen(ninoC.id, tutorA.id)
      const trasOtorgar = await subir(
        tutorA,
        'ninos-fotos',
        `${centro.id}/${ninoC.id}/${randomUUID()}.jpg`,
        JPG,
        'image/jpeg'
      )
      expect(trasOtorgar.error).toBeNull()

      await revocarImagen(ninoC.id)
      const trasRevocar = await subir(
        tutorA,
        'ninos-fotos',
        `${centro.id}/${ninoC.id}/${randomUUID()}.jpg`,
        JPG,
        'image/jpeg'
      )
      expect(trasRevocar.error).not.toBeNull()
    }
  )

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
