import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestFamilia,
  createTestUser,
  crearFamiliaTutor,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestCentro,
  type TestUser,
} from './setup'

import { recolectarNino, recolectarUsuario } from '@/features/export/lib/recolectar'
import type { AdjuntoExport } from '@/features/export/types'

/**
 * Las rutas que firma el export se validan contra su dueño (20270105120000).
 *
 * El export firma con service role las rutas guardadas, y service role no pasa por las policies de
 * Storage. #380 (20261024130000) ató a su familia el DNI del tutor y el mandato; quedaban tres, y
 * las tres se abrían en producción (ensayo del 2026-11-06, terminado en RAISE):
 *
 * - la foto del usuario (`usuarios.foto_url`): la suya, apuntada a la carpeta de otro;
 * - la foto y el libro de familia del niño: la Dirección los escribe directamente;
 * - el DNI de quien recoge, en `firmas_autorizacion.datos.adjuntos`: `firmas_insert` no mira `datos`.
 *   En producción hoy no hay plantillas, y sin plantilla no se firma ninguna recogida; aquí se publica
 *   una, porque esa puerta se trata como abierta.
 *
 * Cada «no» lleva delante la premisa de que el fichero ajeno existe y no es suyo, y al lado el
 * control: su propia ruta entra y el export la firma (el enlace descarga).
 */

const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
const TEXTO = 'Autorizo la recogida de mi hijo por las personas indicadas.'

let centro: TestCentro
let admin: TestUser
let tutorA: TestUser
let tutorB: TestUser
let familiaA: string
let familiaB: string
let ninoA: string
let ninoB: string
let plantilla: string
let instanciaA: string
// Los ficheros de B (el destino de una ruta cruzada) y los de A (el control).
let avatarB: string
let fotoNinoB: string
let libroB: string
let dniRecogidaB: string
let avatarA: string
let libroA: string
let dniRecogidaA: string

async function ninoEn(familiaId: string): Promise<string> {
  const { data, error } = await serviceClient
    .from('ninos')
    .insert({
      centro_id: centro.id,
      familia_id: familiaId,
      nombre: `NinoDueno-${randomUUID().slice(0, 8)}`,
      apellidos: 'Apellido Test',
      fecha_nacimiento: '2024-03-15',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`ninoEn falló: ${error?.message}`)
  return data.id
}

async function subir(bucket: string, path: string, cuerpo: Buffer, tipo: string) {
  const { error } = await serviceClient.storage
    .from(bucket)
    .upload(path, cuerpo, { contentType: tipo, upsert: true })
  if (error) throw new Error(`subir ${bucket} falló: ${error.message}`)
}

async function exportUsuario(user: TestUser): Promise<AdjuntoExport[]> {
  const r = await recolectarUsuario(await clientFor(user), serviceClient, user.id)
  return (r?.data.adjuntos ?? []) as AdjuntoExport[]
}

async function exportNino(user: TestUser, ninoId: string): Promise<AdjuntoExport[]> {
  const r = await recolectarNino(await clientFor(user), serviceClient, ninoId)
  return (r?.data.adjuntos ?? []) as AdjuntoExport[]
}

async function descarga(url: string | null | undefined): Promise<number> {
  if (!url) return 0
  return (await fetch(url)).status
}

function firma(path: string) {
  return {
    autorizacion_id: instanciaA,
    nino_id: ninoA,
    firmante_id: tutorA.id,
    rol_firmante: 'tutor_legal_principal' as const,
    decision: 'firmado' as const,
    texto_hash: 'a'.repeat(64),
    texto_version: 'v1',
    nombre_tecleado: 'Tutor A Dueno',
    firma_imagen: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    datos: {
      personas: [{ nombre: 'Abuela Pruebas', dni: '00000000T', parentesco: 'abuela' }],
      adjuntos: [{ bucket: 'recogida-adjuntos', path, hash: 'x' }],
    },
  }
}

beforeAll(async () => {
  centro = await createTestCentro('Rutas de su dueño')
  familiaA = await createTestFamilia(centro.id)
  familiaB = await createTestFamilia(centro.id)
  admin = await createTestUser({ nombre: 'Admin Dueno' })
  tutorA = await createTestUser({ nombre: 'Tutor A Dueno' })
  tutorB = await createTestUser({ nombre: 'Tutor B Dueno' })
  await asignarRol(admin.id, centro.id, 'admin')
  await asignarRol(tutorA.id, centro.id, 'tutor_legal')
  await asignarRol(tutorB.id, centro.id, 'tutor_legal')
  await crearFamiliaTutor(familiaA, tutorA.id, 'titular')
  await crearFamiliaTutor(familiaB, tutorB.id, 'titular')
  ninoA = await ninoEn(familiaA)
  ninoB = await ninoEn(familiaB)
  await crearVinculo(ninoA, tutorA.id, 'tutor_legal_principal', {
    puede_firmar_autorizaciones: true,
  })
  await crearVinculo(ninoB, tutorB.id, 'tutor_legal_principal', {
    puede_firmar_autorizaciones: true,
  })

  // Los ficheros, en las rutas que dejan las rutas de subida de la app.
  avatarB = `${tutorB.id}/${randomUUID()}.jpg`
  fotoNinoB = `${centro.id}/${ninoB}/${randomUUID()}.jpg`
  libroB = `${centro.id}/${ninoB}/${randomUUID()}.pdf`
  dniRecogidaB = `${centro.id}/${ninoB}/${randomUUID()}.jpg`
  avatarA = `${tutorA.id}/${randomUUID()}.jpg`
  libroA = `${centro.id}/${ninoA}/${randomUUID()}.pdf`
  dniRecogidaA = `${centro.id}/${ninoA}/${randomUUID()}.jpg`
  await subir('usuarios-fotos', avatarB, JPG, 'image/jpeg')
  await subir('ninos-fotos', fotoNinoB, JPG, 'image/jpeg')
  await subir('libro-familia', libroB, PDF, 'application/pdf')
  await subir('recogida-adjuntos', dniRecogidaB, JPG, 'image/jpeg')
  await subir('usuarios-fotos', avatarA, JPG, 'image/jpeg')
  await subir('libro-familia', libroA, PDF, 'application/pdf')
  await subir('recogida-adjuntos', dniRecogidaA, JPG, 'image/jpeg')

  // La plantilla de recogida publicada (la publica la Dirección; en producción hoy no hay ninguna)
  // y la instancia que crea el tutor A desde ella, con su sesión.
  const pl = await serviceClient
    .from('autorizaciones')
    .insert({
      centro_id: centro.id,
      tipo: 'recogida',
      es_plantilla: true,
      titulo: 'Recogida (plantilla)',
      texto: TEXTO,
      texto_version: 'v1',
      texto_definitivo: true,
      estado: 'publicada',
      creado_por: admin.id,
    })
    .select('id')
    .single()
  if (pl.error || !pl.data) throw new Error(`plantilla falló: ${pl.error?.message}`)
  plantilla = pl.data.id
  const inst = await (
    await clientFor(tutorA)
  )
    .from('autorizaciones')
    .insert({
      centro_id: centro.id,
      tipo: 'recogida',
      es_plantilla: false,
      plantilla_id: plantilla,
      ambito: 'nino',
      nino_id: ninoA,
      firmantes_requeridos: 'uno_principal',
      titulo: 'Recogida de Nino A',
      texto: TEXTO,
      texto_version: 'v1',
      texto_definitivo: true,
      estado: 'publicada',
      creado_por: tutorA.id,
    })
    .select('id')
    .single()
  if (inst.error || !inst.data) throw new Error(`instancia falló: ${inst.error?.message}`)
  instanciaA = inst.data.id
}, 120_000)

afterAll(async () => {
  await serviceClient.storage.from('usuarios-fotos').remove([avatarA, avatarB])
  await serviceClient.storage.from('ninos-fotos').remove([fotoNinoB])
  await serviceClient.storage.from('libro-familia').remove([libroA, libroB])
  await serviceClient.storage.from('recogida-adjuntos').remove([dniRecogidaA, dniRecogidaB])
  await serviceClient.from('firmas_autorizacion').delete().eq('autorizacion_id', instanciaA)
  await serviceClient.from('autorizaciones').delete().eq('id', instanciaA)
  await serviceClient.from('autorizaciones').delete().eq('id', plantilla)
  await serviceClient.from('usuarios').update({ foto_url: null }).in('id', [tutorA.id, tutorB.id])
  for (const u of [admin, tutorA, tutorB]) await deleteTestUser(u.id)
  await deleteTestCentro(centro.id)
}, 120_000)

describe('Las rutas que firma el export son de su dueño', () => {
  it('premisa: los ficheros de B existen y tutor A no los puede firmar con su sesión', async () => {
    const c = await clientFor(tutorA)
    for (const [bucket, path] of [
      ['usuarios-fotos', avatarB],
      ['ninos-fotos', fotoNinoB],
      ['libro-familia', libroB],
      ['recogida-adjuntos', dniRecogidaB],
    ] as const) {
      const suya = await c.storage.from(bucket).createSignedUrl(path, 60)
      expect.soft(suya.data?.signedUrl, bucket).toBeFalsy()
      const servicio = await serviceClient.storage.from(bucket).createSignedUrl(path, 60)
      expect.soft(await descarga(servicio.data?.signedUrl), `${bucket} existe`).toBe(200)
    }
    // Y la Dirección es del centro de los dos niños (su «no» sale de la ruta, no de su rol).
    expect((await (await clientFor(admin)).rpc('es_admin', { p_centro_id: centro.id })).data).toBe(
      true
    )
  })

  it('la foto del usuario: no la apunta a la carpeta de otro, tampoco el servidor (23514)', async () => {
    const c = await clientFor(tutorA)
    const sesion = await c.from('usuarios').update({ foto_url: avatarB }).eq('id', tutorA.id)
    expect(sesion.error?.code).toBe('23514')
    const servidor = await serviceClient
      .from('usuarios')
      .update({ foto_url: avatarB })
      .eq('id', tutorA.id)
    expect(servidor.error?.code).toBe('23514')
    expect((await exportUsuario(tutorA)).some((a) => a.path === avatarB)).toBe(false)
  })

  it('la ficha del niño: la Dirección no apunta su foto ni su libro a los de otro niño (23514)', async () => {
    const c = await clientFor(admin)
    const foto = await c.from('ninos').update({ foto_url: fotoNinoB }).eq('id', ninoA)
    expect(foto.error?.code).toBe('23514')
    const libro = await c.from('ninos').update({ libro_familia_path: libroB }).eq('id', ninoA)
    expect(libro.error?.code).toBe('23514')
    // Ni a la carpeta del mismo niño en otro centro.
    const otroCentro = await c
      .from('ninos')
      .update({ libro_familia_path: `${randomUUID()}/${ninoA}/${randomUUID()}.pdf` })
      .eq('id', ninoA)
    expect(otroCentro.error?.code).toBe('23514')
    const adjuntos = await exportNino(admin, ninoA)
    expect(adjuntos.some((a) => a.path === fotoNinoB || a.path === libroB)).toBe(false)
  })

  it('el DNI de quien recoge: la firma no lleva un adjunto de otro niño (23514)', async () => {
    const c = await clientFor(tutorA)
    const { error } = await c.from('firmas_autorizacion').insert(firma(dniRecogidaB))
    expect(error?.code).toBe('23514')
    const deFuera = await c
      .from('firmas_autorizacion')
      .insert(firma(`${randomUUID()}/${ninoA}/${randomUUID()}.jpg`))
    expect(deFuera.error?.code).toBe('23514')
    expect((await exportUsuario(tutorA)).some((a) => a.path === dniRecogidaB)).toBe(false)
  })

  it('control: cada dueño guarda su propia ruta y el export la firma', async () => {
    const cTutor = await clientFor(tutorA)
    expect(
      (await cTutor.from('usuarios').update({ foto_url: avatarA }).eq('id', tutorA.id)).error
    ).toBeNull()
    expect((await cTutor.from('firmas_autorizacion').insert(firma(dniRecogidaA))).error).toBeNull()
    const cAdmin = await clientFor(admin)
    expect(
      (await cAdmin.from('ninos').update({ libro_familia_path: libroA }).eq('id', ninoA)).error
    ).toBeNull()

    const deTutor = await exportUsuario(tutorA)
    for (const path of [avatarA, dniRecogidaA]) {
      expect.soft(await descarga(deTutor.find((a) => a.path === path)?.url_firmada), path).toBe(200)
    }
    const delNino = await exportNino(admin, ninoA)
    expect(await descarga(delNino.find((a) => a.path === libroA)?.url_firmada)).toBe(200)
  })
})
