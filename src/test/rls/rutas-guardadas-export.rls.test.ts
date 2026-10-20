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
 * PR 0b (Fase 4) — una ruta de documento guardada en la BD solo puede ser de su familia.
 *
 * Antes de 20261024130000 (control positivo en el CI del commit 5744503): un tutor apuntaba el
 * `dni_documento_path` de su perfil, o el `documento_path` de un mandato que registraba, al DNI o
 * al mandato de OTRA familia del mismo centro, y su propio export (`recolectarUsuario`, como
 * `/export/me`) se lo firmaba con service role.
 *
 * Ahora un trigger valida la ruta contra la familia de la fila (23514), para cualquiera, también
 * service role. Las rutas de la propia familia siguen valiendo y el export las firma (control).
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
let dniA: string
let mandatoA: string

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
  // Y los de la familia A, para el control.
  dniA = `${centro.id}/${ninoA}/dni-tutor_legal_principal-${randomUUID()}.pdf`
  mandatoA = `${centro.id}/familia/${familiaA}/mandato-${Date.now()}.pdf`
  await subir('dni-tutores', dniA)
  await subir('mandato-sepa', mandatoA)
}, 60_000)

afterAll(async () => {
  await serviceClient.storage.from('dni-tutores').remove([dniB, dniA])
  await serviceClient.storage.from('mandato-sepa').remove([mandatoB, mandatoA])
  await serviceClient.from('mandatos_sepa').delete().eq('centro_id', centro.id)
  await deleteTestUser(tutorA.id)
  await deleteTestUser(tutorB.id)
  await deleteTestCentro(centro.id)
}, 60_000)

function mandato(path: string) {
  return {
    p_familia_id: familiaA,
    p_nino_id: null,
    p_iban: 'ES7620770024003102575766',
    p_titular: 'Tutor A Rutas',
    p_identificador_mandato: `RUTAS-${randomUUID().slice(0, 8)}`,
    p_documento_path: path,
    p_firma_imagen: 'data:image/png;base64,iVBORw0KGgo=',
    p_nombre_tecleado: 'Tutor A Rutas',
    p_texto_hash: 'a'.repeat(64),
    p_ip_address: null,
    p_user_agent: 'test',
    p_fecha_firma: '2026-03-01T10:00:00Z',
    p_metodo: 'digital',
  } as never
}

describe('PR 0b — una ruta guardada solo puede ser de su familia', () => {
  it('premisa: el tutor A no puede firmar con su sesión el DNI ni el mandato de B', async () => {
    const c = await clientFor(tutorA)
    const dni = await c.storage.from('dni-tutores').createSignedUrl(dniB, 60)
    const man = await c.storage.from('mandato-sepa').createSignedUrl(mandatoB, 60)
    expect(dni.data?.signedUrl).toBeFalsy()
    expect(man.data?.signedUrl).toBeFalsy()
  })

  it('no puede apuntar su dni_documento_path al DNI de B, y su export no lo trae', async () => {
    const c = await clientFor(tutorA)
    const { error } = await c
      .from('familia_tutores')
      .update({ dni_documento_path: dniB })
      .eq('familia_id', familiaA)
      .eq('usuario_id', tutorA.id)
    expect(error?.code).toBe('23514')
    expect((await exportDe(tutorA)).some((a) => a.path === dniB)).toBe(false)
  })

  it('tampoco con service role: la regla es de la fila, no de quien escribe', async () => {
    const { error } = await serviceClient
      .from('familia_tutores')
      .update({ dni_documento_path: dniB })
      .eq('familia_id', familiaA)
      .eq('usuario_id', tutorA.id)
    expect(error?.code).toBe('23514')
  })

  it('no puede registrar un mandato con el documento de B', async () => {
    const c = await clientFor(tutorA)
    const { error } = await c.rpc('registrar_mandato_sepa', mandato(mandatoB))
    expect(error?.code).toBe('23514')
    expect((await exportDe(tutorA)).some((a) => a.path === mandatoB)).toBe(false)
  })

  it('control: su propio DNI y su propio mandato se guardan y su export los firma', async () => {
    const c = await clientFor(tutorA)
    const dni = await c
      .from('familia_tutores')
      .update({ dni_documento_path: dniA })
      .eq('familia_id', familiaA)
      .eq('usuario_id', tutorA.id)
    expect(dni.error).toBeNull()
    const man = await c.rpc('registrar_mandato_sepa', mandato(mandatoA))
    expect(man.error).toBeNull()

    const adjuntos = await exportDe(tutorA)
    for (const path of [dniA, mandatoA]) {
      const adjunto = adjuntos.find((a) => a.path === path)
      expect(await descarga(adjunto?.url_firmada ?? null)).toBe(200)
    }
  })
})
