import { randomUUID } from 'node:crypto'

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { borrarFotosDelBlog } from '@/features/fotos/lib/storage'
import { barrerFotosBlogHuerfanas } from '@/features/retencion/lib/fotos-blog-huerfanas'
import type { Database } from '@/types/db'

import { comoPostgres } from './documentos-centro-fixture'
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

type Client = SupabaseClient<Database>

/**
 * Censo C, grupo 1 (decisión de Jose del 2026-11-25): las fotos del blog se borran ANTES que su fila, con
 * la sesión de quien borra, y lo que quede lo recoge el barrido de huérfanos del cron.
 *
 *  - **Lo que hace Storage al negar** (la premisa del diseño): con una sesión que la política
 *    `aula_fotos_delete` no deja (ni Dirección ni autora), `remove` NO da error y la foto sigue. Por eso
 *    `borrarFotosDelBlog` no se cree la respuesta y mira si cada ruta sigue.
 *  - **El barrido** (`aula_fotos_huerfanas`, 20270207120000): una foto que ninguna fila de `media`
 *    nombra, de hace dos días, se cuenta y se borra; la que una fila nombra, o la de hoy, no.
 */

const BUCKET = 'aula-fotos'
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0])

async function existe(ruta: string): Promise<boolean> {
  const corte = ruta.lastIndexOf('/')
  const { data, error } = await serviceClient.storage
    .from(BUCKET)
    .list(ruta.slice(0, corte), { limit: 1000 })
  if (error) throw new Error(`listar: ${error.message}`)
  return (data ?? []).some((o) => o.name === ruta.slice(corte + 1))
}

describe('fotos del blog: primero el fichero, y el barrido de huérfanas', () => {
  let centro: { id: string }
  let aula: { id: string }
  let aulaOtra: { id: string }
  let autora: TestUser
  let otraProfe: TestUser
  let cAutora: Client
  let cOtra: Client
  let pub: string
  const subidas: string[] = []

  const ruta = () => `${centro.id}/${aula.id}/${pub}/${randomUUID()}.jpg`
  async function subir(r: string) {
    const { error } = await serviceClient.storage
      .from(BUCKET)
      .upload(r, JPG, { contentType: 'image/jpeg' })
    if (error) throw new Error(`subir: ${error.message}`)
    subidas.push(r)
  }
  /** De hace dos días: lo que el barrido coge. Solo la BD efímera (`comoPostgres`). */
  const envejecer = (r: string) =>
    comoPostgres(
      `UPDATE storage.objects SET created_at = now() - interval '2 days' WHERE bucket_id = '${BUCKET}' AND name = '${r}';`
    )

  beforeAll(async () => {
    centro = await createTestCentro('Centro Blog Primero Fichero')
    const curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id, 'Aula Blog Fichero')
    aulaOtra = await createTestAula(centro.id, curso.id, 'Aula Blog Fichero 2')
    autora = await createTestUser({ nombre: 'Autora Blog Fichero' })
    otraProfe = await createTestUser({ nombre: 'Otra Profe Blog Fichero' })
    await asignarRol(autora.id, centro.id, 'profe')
    await asignarRol(otraProfe.id, centro.id, 'profe')
    for (const [u, a] of [
      [autora, aula],
      [otraProfe, aulaOtra],
    ] as const) {
      const { error } = await serviceClient.from('profes_aulas').insert({
        profe_id: u.id,
        aula_id: a.id,
        curso_academico_id: curso.id,
        fecha_inicio: '2026-09-01',
        tipo_personal_aula: 'coordinadora',
      })
      if (error) throw new Error(`profes_aulas: ${error.message}`)
    }
    const { data, error } = await serviceClient
      .from('publicaciones')
      .insert({
        centro_id: centro.id,
        aula_id: aula.id,
        autor_id: autora.id,
        texto: 'Blog fichero',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`publicación: ${error?.message}`)
    pub = data.id
    cAutora = await clientFor(autora)
    cOtra = await clientFor(otraProfe)
  }, 90_000)

  afterAll(async () => {
    if (subidas.length) await serviceClient.storage.from(BUCKET).remove(subidas)
    await serviceClient.from('publicaciones').delete().eq('id', pub)
    for (const u of [autora, otraProfe]) await deleteTestUser(u.id)
    await deleteTestCentro(centro.id)
  }, 90_000)

  it('quien no puede borrar: Storage no da error y la foto sigue; borrarFotosDelBlog lo dice', async () => {
    const r = ruta()
    await subir(r)
    const { data: esAdmin } = await cOtra.rpc('es_admin', { p_centro_id: centro.id })
    expect(esAdmin, 'premisa: la otra profe no es Dirección').toBe(false)
    expect(await existe(r), 'premisa: la foto está').toBe(true)

    const crudo = await cOtra.storage.from(BUCKET).remove([r])
    expect(crudo.error, 'Storage, al negar, no da error').toBeNull()
    expect(await existe(r), 'y la foto sigue').toBe(true)

    expect(await borrarFotosDelBlog(cOtra, serviceClient, [r])).toEqual([r])
  })

  it('la autora: se borra, y no queda nada pendiente', async () => {
    const r = ruta()
    await subir(r)
    expect(await existe(r), 'premisa: la foto está').toBe(true)
    expect(await borrarFotosDelBlog(cAutora, serviceClient, [r])).toEqual([])
    expect(await existe(r)).toBe(false)
  })

  it('el barrido: la huérfana de hace dos días se cuenta y se borra; la nombrada y la de hoy, no', async () => {
    const huerfana = ruta()
    const nombrada = ruta()
    const deHoy = ruta()
    for (const r of [huerfana, nombrada, deHoy]) await subir(r)
    const { error: mErr } = await serviceClient.from('media').insert({
      publicacion_id: pub,
      centro_id: centro.id,
      bucket: BUCKET,
      path: nombrada,
      path_miniatura: null,
      mime: 'image/jpeg',
    })
    if (mErr) throw new Error(`media: ${mErr.message}`)
    envejecer(huerfana)
    envejecer(nombrada)

    const { data: lista, error } = await serviceClient.rpc('aula_fotos_huerfanas')
    expect(error).toBeNull()
    const rutas = (lista ?? []).map((l) => l.ruta)
    expect(rutas, 'la huérfana de hace dos días').toContain(huerfana)
    expect(rutas, 'la que nombra una fila').not.toContain(nombrada)
    expect(rutas, 'la de hoy (una subida en curso)').not.toContain(deHoy)

    const r = await barrerFotosBlogHuerfanas({ dryRun: false })
    expect(r.huerfanas).toBeGreaterThanOrEqual(1)
    expect(r.borradas).toBeGreaterThanOrEqual(1)
    expect(r.fallidas).toBe(0)
    expect(await existe(huerfana)).toBe(false)
    expect(await existe(nombrada), 'la nombrada se queda').toBe(true)
    expect(await existe(deHoy), 'la de hoy se queda').toBe(true)
  })

  it('el barrido en simulación solo cuenta', async () => {
    const huerfana = ruta()
    await subir(huerfana)
    envejecer(huerfana)
    const r = await barrerFotosBlogHuerfanas({ dryRun: true })
    expect(r.huerfanas).toBeGreaterThanOrEqual(1)
    expect(r.borradas).toBe(0)
    expect(await existe(huerfana)).toBe(true)
  })

  it('la función es solo del servidor: una sesión recibe 42501', async () => {
    const { error } = await cAutora.rpc('aula_fotos_huerfanas')
    expect(error?.code ?? 'SIN ERROR').toBe('42501')
  })
})
