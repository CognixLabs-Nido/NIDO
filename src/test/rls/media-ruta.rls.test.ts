import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Seguridad R4 — las rutas de Storage de una fila `media` deben ser de su propia publicación.
 *
 * Migración: 20261003140000_fix_media_ruta_publicacion
 *   Trigger `media_validar_ruta_trg` (BEFORE INSERT OR UPDATE): `path` y `path_miniatura` =
 *   `{centro}/{aula}/{publicacion}/<nombre>.jpg`, con centro/aula de la publicación de la fila.
 *
 * El agujero: `media_insert` solo pide ser autor de la publicación (o admin), así que una
 * redactora podía insertar en SU publicación una fila con la ruta del objeto de OTRA
 * publicación/aula/centro; al quitar esa foto, la app la borraba con service role. Aquí se ataca
 * por PostgREST con el cliente de la redactora y se comprueba que la BD lo para (23514), que el
 * flujo legítimo sigue y que tampoco admin ni service role cuelan una ruta ajena.
 *
 * No toca Storage: solo inserta filas `media`. El "no borra" de la app lo cubren los tests
 * unitarios de `eliminarMedia` / `eliminarPublicacion`.
 *
 * Gateado (la migración la aplica Jose a mano): MEDIA_RUTA_APPLIED=1
 */

const MIGRATION_APPLIED = process.env.MEDIA_RUTA_APPLIED === '1'

type Client = SupabaseClient<Database>

describe.skipIf(!MIGRATION_APPLIED)('media — rutas de Storage de la propia publicación', () => {
  let centro: { id: string }
  let centroB: { id: string }
  let aula: { id: string }
  let aulaB: { id: string }
  let coordinadora: TestUser
  let admin: TestUser
  let cCoord: Client
  let cAdmin: Client
  let pubCoord: string // publicación de la coordinadora (donde mete la fila)
  let pubVictima: string // otra publicación del aula (dueña de los objetos "ajenos")

  beforeAll(async () => {
    centro = await createTestCentro('Centro Media Ruta')
    centroB = await createTestCentro('Centro Media Ruta B')
    const curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id, 'Aula Media Ruta')
    aulaB = await createTestAula(centro.id, curso.id, 'Aula Media Ruta 2')

    coordinadora = await createTestUser({ nombre: 'Coord Media Ruta' })
    admin = await createTestUser({ nombre: 'Admin Media Ruta' })
    await asignarRol(coordinadora.id, centro.id, 'profe')
    await asignarRol(admin.id, centro.id, 'admin')
    const { error: paErr } = await serviceClient.from('profes_aulas').insert({
      profe_id: coordinadora.id,
      aula_id: aula.id,
      curso_academico_id: curso.id,
      fecha_inicio: '2026-09-01',
      tipo_personal_aula: 'coordinadora',
    })
    if (paErr) throw new Error(`profes_aulas: ${paErr.message}`)

    const pub = async (autor: string) => {
      const { data, error } = await serviceClient
        .from('publicaciones')
        .insert({ centro_id: centro.id, aula_id: aula.id, autor_id: autor, texto: 'Media ruta' })
        .select('id')
        .single()
      if (error || !data) throw new Error(`publicación: ${error?.message}`)
      return data.id
    }
    pubCoord = await pub(coordinadora.id)
    pubVictima = await pub(admin.id)

    cCoord = await clientFor(coordinadora)
    cAdmin = await clientFor(admin)
  }, 90_000)

  afterAll(async () => {
    await serviceClient.from('publicaciones').delete().in('id', [pubCoord, pubVictima])
    for (const u of [coordinadora, admin]) await deleteTestUser(u.id)
    for (const c of [centro, centroB]) await deleteTestCentro(c.id)
  }, 90_000)

  const prefijo = () => `${centro.id}/${aula.id}/${pubCoord}`
  const propia = (sufijo = '') => `${prefijo()}/${randomUUID()}${sufijo}.jpg`

  const insertarMedia = (client: Client, path: string, path_miniatura: string | null) =>
    client
      .from('media')
      .insert({
        publicacion_id: pubCoord,
        centro_id: centro.id,
        bucket: 'aula-fotos',
        path,
        path_miniatura,
        mime: 'image/jpeg',
      })
      .select('id')
      .maybeSingle()

  it('flujo legítimo: la redactora inserta original + miniatura de su publicación y la quita', async () => {
    const r = await insertarMedia(cCoord, propia(), propia('_thumb'))
    expect(r.error).toBeNull()
    expect(r.data).not.toBeNull()

    const del = await cCoord.from('media').delete({ count: 'exact' }).eq('id', r.data!.id)
    expect(del.error).toBeNull()
    expect(del.count).toBe(1)
  })

  it('miniatura NULL con original legítimo → OK', async () => {
    const r = await insertarMedia(cCoord, propia(), null)
    expect(r.error).toBeNull()
  })

  const ajenas: [string, () => string][] = [
    ['objeto de OTRA publicación del aula', () => `${centro.id}/${aula.id}/${pubVictima}/x.jpg`],
    ['otra aula', () => `${centro.id}/${aulaB.id}/${pubCoord}/x.jpg`],
    ['otro centro', () => `${centroB.id}/${aula.id}/${pubCoord}/x.jpg`],
    ['escapa con ..', () => `${prefijo()}/../${pubVictima}/x.jpg`],
    ['subcarpeta', () => `${prefijo()}/sub/x.jpg`],
    ['no es jpg', () => `${prefijo()}/x.png`],
  ]

  it.each(ajenas)(
    'la redactora NO puede poner una miniatura ajena: %s (23514)',
    async (_c, ajena) => {
      const r = await insertarMedia(cCoord, propia(), ajena())
      expect(r.error?.code).toBe('23514')
      expect(r.data).toBeNull()
    }
  )

  it.each(ajenas)(
    'la redactora NO puede poner un original ajeno: %s (23514)',
    async (_c, ajena) => {
      const r = await insertarMedia(cCoord, ajena(), propia('_thumb'))
      expect(r.error?.code).toBe('23514')
    }
  )

  it('tampoco el admin del centro cuela una ruta ajena (23514)', async () => {
    const r = await insertarMedia(cAdmin, propia(), `${centro.id}/${aula.id}/${pubVictima}/x.jpg`)
    expect(r.error?.code).toBe('23514')
  })

  it('tampoco service role (el trigger aplica a todos) (23514)', async () => {
    const r = await insertarMedia(
      serviceClient,
      `${centro.id}/${aula.id}/${pubVictima}/x.jpg`,
      null
    )
    expect(r.error?.code).toBe('23514')
  })

  it('un UPDATE a una ruta ajena también se para (23514)', async () => {
    const ins = await insertarMedia(serviceClient, propia(), propia('_thumb'))
    expect(ins.error).toBeNull()
    const upd = await serviceClient
      .from('media')
      .update({ path_miniatura: `${centro.id}/${aula.id}/${pubVictima}/x.jpg` })
      .eq('id', ins.data!.id)
      .select('id')
      .maybeSingle()
    expect(upd.error?.code).toBe('23514')
  })
})
