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
 * PR 3 (Fase 4) — policies de Storage. CONTROL POSITIVO: se demuestran contra la BD efímera
 * los dos huecos del diagnóstico.
 *
 *   1. Ninguna policy comprueba que el niño, la familia o el aula de la ruta (`[2]`, `[3]`) sean
 *      del centro de la ruta (`[1]`). Cada rama mira solo uno de los dos, así que se pueden dejar
 *      ficheros en el prefijo de otro centro: el tutor de un niño de B sube un PDF a `A/niñoB/` y
 *      la directora de A lo ve.
 *   2. Un objeto en la raíz del bucket, sin carpeta, tiene `[1]` NULL, y `es_admin(NULL)` es TRUE
 *      para cualquier admin: lo sube una directora y lo lee y lo borra la de otro centro.
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

describe('PR 3 — control positivo: rutas que cruzan de centro y objetos en la raíz', () => {
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

  it('dni-tutores: el tutor de B sube el DNI a A/niñoB/ y la directora de A lo lee', async () => {
    const path = `${centroA.id}/${ninoB.id}/${randomUUID()}.pdf`
    expect((await subir(tutorB, 'dni-tutores', path, PDF, 'application/pdf')).error).toBeNull()
    expect((await leer(directoraA, 'dni-tutores', path)).error).toBeNull()
  })

  it('libro-familia: la directora de A sube a A/niñoB/ y el tutor de B lo lee', async () => {
    const path = `${centroA.id}/${ninoB.id}/${randomUUID()}.pdf`
    expect(
      (await subir(directoraA, 'libro-familia', path, PDF, 'application/pdf')).error
    ).toBeNull()
    expect((await leer(tutorB, 'libro-familia', path)).error).toBeNull()
  })

  it('mandato-sepa por familia: el tutor de B sube a A/familia/familiaB/ y la directora de A lo lee', async () => {
    const path = `${centroA.id}/familia/${ninoB.familia_id}/${randomUUID()}.pdf`
    expect((await subir(tutorB, 'mandato-sepa', path, PDF, 'application/pdf')).error).toBeNull()
    expect((await leer(directoraA, 'mandato-sepa', path)).error).toBeNull()
  })

  it('ninos-fotos: el tutor de B sube la foto a A/niñoB/ y la directora de A la lee', async () => {
    const path = `${centroA.id}/${ninoB.id}/${randomUUID()}.jpg`
    expect((await subir(tutorB, 'ninos-fotos', path, JPG, 'image/jpeg')).error).toBeNull()
    expect((await leer(directoraA, 'ninos-fotos', path)).error).toBeNull()
  })

  it('recogida-adjuntos: la profe de A sube a A/niñoB/ y el tutor de B lo lee', async () => {
    const path = `${centroA.id}/${ninoB.id}/${randomUUID()}.jpg`
    expect((await subir(profeA, 'recogida-adjuntos', path, JPG, 'image/jpeg')).error).toBeNull()
    expect((await leer(tutorB, 'recogida-adjuntos', path)).error).toBeNull()
  })

  it('aula-fotos: la profe de B sube a A/aulaB/publicaciónB/ y la directora de A lo lee', async () => {
    const path = `${centroA.id}/${aulaB.id}/${publicacionB}/${randomUUID()}.jpg`
    expect((await subir(profeB, 'aula-fotos', path, JPG, 'image/jpeg')).error).toBeNull()
    expect((await leer(directoraA, 'aula-fotos', path)).error).toBeNull()
  })

  it('raíz de dni-tutores: la directora de A sube sin carpeta, y la de B lo lee y lo borra', async () => {
    const path = `${randomUUID()}.pdf`
    expect((await subir(directoraA, 'dni-tutores', path, PDF, 'application/pdf')).error).toBeNull()
    expect((await leer(directoraB, 'dni-tutores', path)).error).toBeNull()
    const cB = await clientFor(directoraB)
    const { data: borrados } = await cB.storage.from('dni-tutores').remove([path])
    expect(borrados).toHaveLength(1)
  })

  it('raíz de centro-assets: la directora de A sube sin carpeta y la de B lo borra', async () => {
    const path = `${randomUUID()}.png`
    expect((await subir(directoraA, 'centro-assets', path, PNG, 'image/png')).error).toBeNull()
    const cB = await clientFor(directoraB)
    const { data: borrados } = await cB.storage.from('centro-assets').remove([path])
    expect(borrados).toHaveLength(1)
  })
})
