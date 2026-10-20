import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarProfeAula,
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestUser,
  crearFamiliaTutor,
  crearVinculo,
  createTestNino,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestAula,
  type TestCentro,
  type TestNino,
  type TestUser,
} from './setup'

/**
 * PR 3 (Fase 4) — las rutas de Storage no cruzan de centro, y nadie escribe en la raíz.
 *
 * Migración: 20261027120000_fix_storage_ruta_coherente
 *   - Las 28 policies con niño, familia o aula en la ruta exigen `ruta_coherente(bucket, name)`:
 *     que `[2]` (o `[3]`) sea del centro de `[1]`. Ya no se deja un fichero en el prefijo de otro
 *     centro, ni se lee uno que estuviera ahí.
 *   - Las 3 de escritura de `centro-assets` exigen carpeta: `es_admin(NULL)` ya no abre la raíz.
 *
 * El control positivo (commit da54f53) demostró los ataques contra la BD efímera. Cada caso
 * comprueba ahora tres cosas: la subida cruzada se rechaza; un objeto que el servicio deja en esa
 * ruta no lo lee el otro lado; y la ruta coherente sigue funcionando para quien le toca.
 */

const PDF = Buffer.from('%PDF-1.4\n%prueba\n')
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

let centroA: TestCentro
let centroB: TestCentro
let aulaB: TestAula
let ninoB: TestNino
let publicacionB: string
let directoraA: TestUser
let profeA: TestUser
let directoraB: TestUser
let tutorB: TestUser
let profeB: TestUser

// Todo lo que se intenta subir, para borrarlo al final por la API de Storage (nunca por SQL).
const intentos: Array<{ bucket: string; path: string }> = []

async function subir(user: TestUser, bucket: string, path: string, body: Buffer, tipo: string) {
  intentos.push({ bucket, path })
  const c = await clientFor(user)
  return c.storage.from(bucket).upload(path, body, { contentType: tipo, upsert: true })
}

async function leer(user: TestUser, bucket: string, path: string) {
  const c = await clientFor(user)
  return c.storage.from(bucket).download(path)
}

/** Deja el objeto con el servicio (sin RLS), como si hubiera llegado antes del arreglo. */
async function sembrar(bucket: string, path: string, body: Buffer, tipo: string) {
  intentos.push({ bucket, path })
  const { error } = await serviceClient.storage
    .from(bucket)
    .upload(path, body, { contentType: tipo, upsert: true })
  if (error) throw new Error(`sembrar ${bucket} falló: ${error.message}`)
}

beforeAll(async () => {
  centroA = await createTestCentro('Storage A')
  centroB = await createTestCentro('Storage B')
  const cursoA = await createTestCurso(centroA.id)
  await createTestAula(centroA.id, cursoA.id)
  const cursoB = await createTestCurso(centroB.id)
  aulaB = await createTestAula(centroB.id, cursoB.id)

  directoraA = await createTestUser({ nombre: 'Directora A Storage' })
  await asignarRol(directoraA.id, centroA.id, 'admin')
  profeA = await createTestUser({ nombre: 'Profe A Storage' })
  await asignarRol(profeA.id, centroA.id, 'profe')

  directoraB = await createTestUser({ nombre: 'Directora B Storage' })
  await asignarRol(directoraB.id, centroB.id, 'admin')
  tutorB = await createTestUser({ nombre: 'Tutor B Storage' })
  await asignarRol(tutorB.id, centroB.id, 'tutor_legal')
  ninoB = await createTestNino(centroB.id)
  await matricular(ninoB.id, aulaB.id, cursoB.id)
  await crearVinculo(ninoB.id, tutorB.id, 'tutor_legal_principal')
  await crearFamiliaTutor(ninoB.familia_id, tutorB.id, 'titular')
  const { error: errImagen } = await serviceClient.rpc('otorgar_consentimiento_imagen', {
    p_nino_id: ninoB.id,
    p_tutor: tutorB.id,
  })
  if (errImagen) throw new Error(`consentimiento de imagen falló: ${errImagen.message}`)

  profeB = await createTestUser({ nombre: 'Profe B Storage' })
  await asignarRol(profeB.id, centroB.id, 'profe')
  await asignarProfeAula(profeB.id, aulaB.id, cursoB.id)
  const { data: pub, error: errPub } = await serviceClient
    .from('publicaciones')
    .insert({ centro_id: centroB.id, aula_id: aulaB.id, autor_id: profeB.id, texto: 'Prueba' })
    .select('id')
    .single()
  if (errPub || !pub) throw new Error(`publicación falló: ${errPub?.message}`)
  publicacionB = pub.id
}, 120_000)

afterAll(async () => {
  for (const o of intentos) await serviceClient.storage.from(o.bucket).remove([o.path])
  await serviceClient.from('publicaciones').delete().eq('id', publicacionB)
  await serviceClient.from('consentimientos').delete().eq('nino_id', ninoB.id)
  for (const u of [directoraA, profeA, directoraB, tutorB, profeB])
    if (u) await deleteTestUser(u.id)
  await deleteTestCentro(centroA.id)
  await deleteTestCentro(centroB.id)
}, 120_000)

describe('PR 3 — las rutas de Storage no cruzan de centro', () => {
  it('premisa: los de B no tienen rol en A, ni la directora de A en B', async () => {
    const { count } = await serviceClient
      .from('roles_usuario')
      .select('id', { count: 'exact', head: true })
      .or(
        `and(usuario_id.in.(${tutorB.id},${profeB.id},${directoraB.id}),centro_id.eq.${centroA.id}),` +
          `and(usuario_id.in.(${directoraA.id},${profeA.id}),centro_id.eq.${centroB.id})`
      )
    expect(count).toBe(0)
  })

  it('dni-tutores: el tutor de B no sube a A/niñoB/, la directora de A no lee lo que haya, y en B/niñoB/ sí', async () => {
    const cruzada = `${centroA.id}/${ninoB.id}/${randomUUID()}.pdf`
    expect(
      (await subir(tutorB, 'dni-tutores', cruzada, PDF, 'application/pdf')).error
    ).not.toBeNull()
    await sembrar('dni-tutores', cruzada, PDF, 'application/pdf')
    expect((await leer(directoraA, 'dni-tutores', cruzada)).error).not.toBeNull()
    expect((await leer(tutorB, 'dni-tutores', cruzada)).error).not.toBeNull()

    const propia = `${centroB.id}/${ninoB.id}/${randomUUID()}.pdf`
    expect((await subir(tutorB, 'dni-tutores', propia, PDF, 'application/pdf')).error).toBeNull()
    expect((await leer(directoraB, 'dni-tutores', propia)).error).toBeNull()
  })

  it('libro-familia: la directora de A no sube a A/niñoB/ y el tutor de B no lee lo que haya', async () => {
    const cruzada = `${centroA.id}/${ninoB.id}/${randomUUID()}.pdf`
    expect(
      (await subir(directoraA, 'libro-familia', cruzada, PDF, 'application/pdf')).error
    ).not.toBeNull()
    await sembrar('libro-familia', cruzada, PDF, 'application/pdf')
    expect((await leer(tutorB, 'libro-familia', cruzada)).error).not.toBeNull()

    const propia = `${centroB.id}/${ninoB.id}/${randomUUID()}.pdf`
    expect(
      (await subir(directoraB, 'libro-familia', propia, PDF, 'application/pdf')).error
    ).toBeNull()
    expect((await leer(tutorB, 'libro-familia', propia)).error).toBeNull()
  })

  it('mandato-sepa por familia: no a A/familia/familiaB/; sí a B/familia/familiaB/', async () => {
    const cruzada = `${centroA.id}/familia/${ninoB.familia_id}/${randomUUID()}.pdf`
    expect(
      (await subir(tutorB, 'mandato-sepa', cruzada, PDF, 'application/pdf')).error
    ).not.toBeNull()
    await sembrar('mandato-sepa', cruzada, PDF, 'application/pdf')
    expect((await leer(directoraA, 'mandato-sepa', cruzada)).error).not.toBeNull()

    const propia = `${centroB.id}/familia/${ninoB.familia_id}/${randomUUID()}.pdf`
    expect((await subir(tutorB, 'mandato-sepa', propia, PDF, 'application/pdf')).error).toBeNull()
    expect((await leer(directoraB, 'mandato-sepa', propia)).error).toBeNull()
  })

  it('mandato-sepa por niño: la ruta del niño sigue igual', async () => {
    const propia = `${centroB.id}/${ninoB.id}/${randomUUID()}.pdf`
    expect((await subir(tutorB, 'mandato-sepa', propia, PDF, 'application/pdf')).error).toBeNull()
    const cruzada = `${centroA.id}/${ninoB.id}/${randomUUID()}.pdf`
    expect(
      (await subir(tutorB, 'mandato-sepa', cruzada, PDF, 'application/pdf')).error
    ).not.toBeNull()
  })

  it('ninos-fotos: el tutor de B no sube a A/niñoB/ y la directora de A no lee lo que haya', async () => {
    const cruzada = `${centroA.id}/${ninoB.id}/${randomUUID()}.jpg`
    expect((await subir(tutorB, 'ninos-fotos', cruzada, JPG, 'image/jpeg')).error).not.toBeNull()
    await sembrar('ninos-fotos', cruzada, JPG, 'image/jpeg')
    expect((await leer(directoraA, 'ninos-fotos', cruzada)).error).not.toBeNull()

    const propia = `${centroB.id}/${ninoB.id}/${randomUUID()}.jpg`
    expect((await subir(tutorB, 'ninos-fotos', propia, JPG, 'image/jpeg')).error).toBeNull()
    expect((await leer(directoraB, 'ninos-fotos', propia)).error).toBeNull()
  })

  it('recogida-adjuntos: la profe de A no sube a A/niñoB/ y el tutor de B no lee lo que haya', async () => {
    const cruzada = `${centroA.id}/${ninoB.id}/${randomUUID()}.jpg`
    expect(
      (await subir(profeA, 'recogida-adjuntos', cruzada, JPG, 'image/jpeg')).error
    ).not.toBeNull()
    await sembrar('recogida-adjuntos', cruzada, JPG, 'image/jpeg')
    expect((await leer(tutorB, 'recogida-adjuntos', cruzada)).error).not.toBeNull()

    const propia = `${centroB.id}/${ninoB.id}/${randomUUID()}.jpg`
    expect((await subir(tutorB, 'recogida-adjuntos', propia, JPG, 'image/jpeg')).error).toBeNull()
    expect((await leer(directoraB, 'recogida-adjuntos', propia)).error).toBeNull()
  })

  it('aula-fotos: la profe de B no sube a A/aulaB/publicaciónB/ y la directora de A no lee lo que haya', async () => {
    const cruzada = `${centroA.id}/${aulaB.id}/${publicacionB}/${randomUUID()}.jpg`
    expect((await subir(profeB, 'aula-fotos', cruzada, JPG, 'image/jpeg')).error).not.toBeNull()
    await sembrar('aula-fotos', cruzada, JPG, 'image/jpeg')
    expect((await leer(directoraA, 'aula-fotos', cruzada)).error).not.toBeNull()

    const propia = `${centroB.id}/${aulaB.id}/${publicacionB}/${randomUUID()}.jpg`
    expect((await subir(profeB, 'aula-fotos', propia, JPG, 'image/jpeg')).error).toBeNull()
    expect((await leer(directoraB, 'aula-fotos', propia)).error).toBeNull()
  })

  it('raíz de dni-tutores: nadie sube sin carpeta, y lo que haya ni se lee ni se borra con sesión', async () => {
    const path = `${randomUUID()}.pdf`
    expect(
      (await subir(directoraA, 'dni-tutores', path, PDF, 'application/pdf')).error
    ).not.toBeNull()
    await sembrar('dni-tutores', path, PDF, 'application/pdf')
    expect((await leer(directoraB, 'dni-tutores', path)).error).not.toBeNull()
    const cB = await clientFor(directoraB)
    const { data: borrados } = await cB.storage.from('dni-tutores').remove([path])
    expect(borrados ?? []).toHaveLength(0)
    // Sigue ahí: el servicio lo lee.
    expect((await serviceClient.storage.from('dni-tutores').download(path)).error).toBeNull()
  })

  it('raíz de centro-assets: nadie sube ni borra sin carpeta; el logo de su centro, sí', async () => {
    const path = `${randomUUID()}.png`
    expect((await subir(directoraA, 'centro-assets', path, PNG, 'image/png')).error).not.toBeNull()
    await sembrar('centro-assets', path, PNG, 'image/png')
    const cB = await clientFor(directoraB)
    const { data: borrados } = await cB.storage.from('centro-assets').remove([path])
    expect(borrados ?? []).toHaveLength(0)

    const logo = `${centroA.id}/logo.png`
    expect((await subir(directoraA, 'centro-assets', logo, PNG, 'image/png')).error).toBeNull()
  })
})
