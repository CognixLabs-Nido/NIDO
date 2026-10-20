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

import { recolectarUsuario } from '@/features/export/lib/recolectar'
import type { AdjuntoExport } from '@/features/export/types'

/**
 * PR 0b — CONTROL POSITIVO del ataque, antes del arreglo (este fichero se invierte en el commit
 * que lo cierra). Un tutor apunta una ruta suya guardada en la BD (`dni_documento_path` de su
 * perfil, `documento_path` de su mandato) al DNI o al mandato de OTRA familia del mismo centro, y
 * su propio export (`recolectarUsuario`, como `/export/me`) le firma ese fichero con service role.
 */

const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])

let centro: TestCentro
let tutorA: TestUser
let tutorB: TestUser
let familiaA: string
let familiaB: string
let ninoA: string
let ninoB: string
let dniB: string
let mandatoB: string

async function ninoEn(familiaId: string): Promise<string> {
  const { data, error } = await serviceClient
    .from('ninos')
    .insert({
      centro_id: centro.id,
      familia_id: familiaId,
      nombre: `NinoRutas-${randomUUID().slice(0, 8)}`,
      apellidos: 'Apellido Test',
      fecha_nacimiento: '2024-03-15',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`ninoEn falló: ${error?.message}`)
  return data.id
}

async function subir(bucket: string, path: string) {
  const { error } = await serviceClient.storage
    .from(bucket)
    .upload(path, PDF, { contentType: 'application/pdf', upsert: true })
  if (error) throw new Error(`subir ${bucket} falló: ${error.message}`)
}

/** Las URL firmadas que el export de `usuario` le da, por bucket y ruta. */
async function exportDe(user: TestUser) {
  const c = await clientFor(user)
  const r = await recolectarUsuario(c, serviceClient, user.id)
  return (r?.data.adjuntos ?? []) as AdjuntoExport[]
}

async function descarga(url: string | null): Promise<number> {
  if (!url) return 0
  return (await fetch(url)).status
}

beforeAll(async () => {
  centro = await createTestCentro('Rutas guardadas')
  familiaA = await createTestFamilia(centro.id)
  familiaB = await createTestFamilia(centro.id)
  tutorA = await createTestUser({ nombre: 'Tutor A Rutas' })
  tutorB = await createTestUser({ nombre: 'Tutor B Rutas' })
  await asignarRol(tutorA.id, centro.id, 'tutor_legal')
  await asignarRol(tutorB.id, centro.id, 'tutor_legal')
  await crearFamiliaTutor(familiaA, tutorA.id, 'titular')
  await crearFamiliaTutor(familiaB, tutorB.id, 'titular')
  ninoA = await ninoEn(familiaA)
  ninoB = await ninoEn(familiaB)
  await crearVinculo(ninoA, tutorA.id, 'tutor_legal_principal')
  await crearVinculo(ninoB, tutorB.id, 'tutor_legal_principal')

  // Los documentos de la familia B, en sus rutas de verdad (como los dejan sus rutas de subida).
  dniB = `${centro.id}/${ninoB}/dni-tutor_legal_principal-${randomUUID()}.pdf`
  mandatoB = `${centro.id}/familia/${familiaB}/mandato-${Date.now()}.pdf`
  await subir('dni-tutores', dniB)
  await subir('mandato-sepa', mandatoB)
}, 60_000)

afterAll(async () => {
  await serviceClient.storage.from('dni-tutores').remove([dniB])
  await serviceClient.storage.from('mandato-sepa').remove([mandatoB])
  await serviceClient.from('mandatos_sepa').delete().eq('centro_id', centro.id)
  await deleteTestUser(tutorA.id)
  await deleteTestUser(tutorB.id)
  await deleteTestCentro(centro.id)
}, 60_000)

describe('PR 0b — control positivo: el ataque funciona hoy', () => {
  it('premisa: el tutor A no puede firmar con su sesión el DNI ni el mandato de B', async () => {
    const c = await clientFor(tutorA)
    const dni = await c.storage.from('dni-tutores').createSignedUrl(dniB, 60)
    const man = await c.storage.from('mandato-sepa').createSignedUrl(mandatoB, 60)
    expect(dni.data?.signedUrl).toBeFalsy()
    expect(man.data?.signedUrl).toBeFalsy()
  })

  it('apunta su dni_documento_path al DNI de B y su export se lo firma', async () => {
    const c = await clientFor(tutorA)
    const { error } = await c
      .from('familia_tutores')
      .update({ dni_documento_path: dniB })
      .eq('familia_id', familiaA)
      .eq('usuario_id', tutorA.id)
    expect(error).toBeNull()

    const adjunto = (await exportDe(tutorA)).find((a) => a.path === dniB)
    expect(adjunto?.url_firmada).toBeTruthy()
    expect(await descarga(adjunto?.url_firmada ?? null)).toBe(200)
  })

  it('registra un mandato con el documento de B y su export se lo firma', async () => {
    const c = await clientFor(tutorA)
    const { error } = await c.rpc('registrar_mandato_sepa', {
      p_familia_id: familiaA,
      p_nino_id: null,
      p_iban: 'ES7620770024003102575766',
      p_titular: 'Tutor A Rutas',
      p_identificador_mandato: `RUTAS-${randomUUID().slice(0, 8)}`,
      p_documento_path: mandatoB,
      p_firma_imagen: 'data:image/png;base64,iVBORw0KGgo=',
      p_nombre_tecleado: 'Tutor A Rutas',
      p_texto_hash: 'a'.repeat(64),
      p_ip_address: null,
      p_user_agent: 'test',
      p_fecha_firma: '2026-03-01T10:00:00Z',
      p_metodo: 'digital',
    } as never)
    expect(error).toBeNull()

    const adjunto = (await exportDe(tutorA)).find((a) => a.path === mandatoB)
    expect(adjunto?.url_firmada).toBeTruthy()
    expect(await descarga(adjunto?.url_firmada ?? null)).toBe(200)
  })
})
