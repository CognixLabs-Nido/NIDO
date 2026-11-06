import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

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
  type TestCentro,
  type TestUser,
} from './setup'

/**
 * `media` es solo del blog y su único bucket es `aula-fotos` (CHECK `media_bucket_blog`,
 * 20270107120000). El export firma con el servicio el bucket y la ruta de la fila, y el trigger de la
 * ruta la valida contra la publicación pero no mira el bucket. Que una fila con otro bucket hoy no
 * lleve a ningún fichero es una casualidad de la forma de las rutas (ningún otro bucket tiene
 * ficheros de cuatro niveles), no una defensa: la defensa es el CHECK.
 */
describe('media.bucket: solo aula-fotos (20270107120000)', () => {
  let centro: TestCentro
  let admin: TestUser
  let cAdmin: SupabaseClient<Database>
  let aula: string
  let pub: string
  const ruta = () => `${centro.id}/${aula}/${pub}/${randomUUID()}.jpg`
  const fila = (bucket: string) => ({
    publicacion_id: pub,
    centro_id: centro.id,
    bucket,
    path: ruta(),
    mime: 'image/jpeg',
  })

  beforeAll(async () => {
    centro = await createTestCentro('Centro media bucket')
    const curso = await createTestCurso(centro.id)
    aula = (await createTestAula(centro.id, curso.id)).id
    admin = await createTestUser({ nombre: 'Admin media bucket' })
    await asignarRol(admin.id, centro.id, 'admin')
    cAdmin = await clientFor(admin)
    const { data, error } = await serviceClient
      .from('publicaciones')
      .insert({ centro_id: centro.id, aula_id: aula, autor_id: admin.id, texto: 'Prueba' })
      .select('id')
      .single()
    if (error) throw new Error(`publicación: ${error.message}`)
    pub = data.id
  })

  afterAll(async () => {
    await serviceClient.from('media').delete().eq('publicacion_id', pub)
    await serviceClient.from('publicaciones').delete().eq('id', pub)
    await deleteTestCentro(centro.id)
    await deleteTestUser(admin.id)
  })

  it('premisa: la Dirección del centro mete una foto en su publicación, con la ruta de esa publicación', async () => {
    const { error } = await cAdmin.from('media').insert(fila('aula-fotos'))
    expect(error).toBeNull()
  })

  it.each(['dni-tutores', 'libro-familia', 'mandato-sepa', 'recogida-adjuntos', 'ninos-fotos'])(
    'la misma fila en %s, nada: ni con la sesión ni con el servicio (23514)',
    async (bucket) => {
      const sesion = await cAdmin.from('media').insert(fila(bucket))
      expect(sesion.error?.code).toBe('23514')
      expect(sesion.error?.message).toContain('media_bucket_blog')
      const servicio = await serviceClient.from('media').insert(fila(bucket))
      expect(servicio.error?.code).toBe('23514')
      expect(servicio.error?.message).toContain('media_bucket_blog')
    }
  )
})
