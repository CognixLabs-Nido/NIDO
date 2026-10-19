import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import {
  asignarProfeAula,
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
  type TestNino,
  type TestUser,
} from './setup'

/**
 * Multicentro — mensajería por centro: el badge de mensajes, la lista de anuncios de `/messages`
 * y la supervisión de la directora.
 *
 * La RLS deja leer lo de todos los centros del usuario. Un profe en A que es tutor en B veía en
 * el badge y en los anuncios de A lo de B, y una directora de dos centros supervisaba en A las
 * conversaciones de B. Las tres consultas reciben ahora el centro de la página. La rama del admin
 * en el badge (sus hilos dirección↔familia) va con el hilo por centro, en el PR B de la Fase 2.
 * El detalle de un anuncio abierto por URL (o por una notificación) también es solo el del centro.
 * Cada caso empieza por su premisa: sin acotar, la RLS deja ver lo de los dos centros.
 */

const sesion = vi.hoisted(() => ({ actual: null as SupabaseClient<Database> | null }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!sesion.actual) throw new Error('test: falta la sesión de quien actúa')
    return sesion.actual
  },
}))

const { countNoLeidos } = await import('@/features/messaging/queries/count-no-leidos')
const { getAnunciosDelUsuario } = await import('@/features/messaging/queries/get-anuncios')
const { getAnuncioDetalle } = await import('@/features/messaging/queries/get-anuncio-detalle')
const { getConversacionesDelUsuario } =
  await import('@/features/messaging/queries/get-conversaciones')

describe('Multicentro — mensajería por centro', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let directora: TestUser // admin en A y en B
  let usuario: TestUser // profe en A, tutor en B
  let tutorA: TestUser
  let profeB: TestUser
  let ninoA: TestNino
  let ninoB: TestNino
  let convA: string
  let convB: string
  let anuncioA: string
  let anuncioB: string
  let cUsuario: SupabaseClient<Database>
  let cDirectora: SupabaseClient<Database>

  async function insertar<T extends 'conversaciones' | 'mensajes' | 'anuncios'>(
    tabla: T,
    fila: Database['public']['Tables'][T]['Insert']
  ): Promise<string> {
    const { data, error } = await serviceClient
      .from(tabla)
      .insert(fila as never)
      .select('id')
      .single()
    if (error || !data) throw new Error(`${tabla}: ${error?.message}`)
    return (data as unknown as { id: string }).id
  }

  beforeAll(async () => {
    centroA = await createTestCentro('Centro Mensajeria A')
    centroB = await createTestCentro('Centro Mensajeria B')
    const cursoA = await createTestCurso(centroA.id)
    const cursoB = await createTestCurso(centroB.id)
    const aulaA = await createTestAula(centroA.id, cursoA.id, 'Aula Mensajeria A')
    const aulaB = await createTestAula(centroB.id, cursoB.id, 'Aula Mensajeria B')
    ninoA = await createTestNino(centroA.id, 'Niño Mensajeria A')
    ninoB = await createTestNino(centroB.id, 'Niño Mensajeria B')
    await matricular(ninoA.id, aulaA.id, cursoA.id)
    await matricular(ninoB.id, aulaB.id, cursoB.id)

    directora = await createTestUser({ nombre: 'Directora A y B' })
    usuario = await createTestUser({ nombre: 'Profe A Tutor B' })
    tutorA = await createTestUser({ nombre: 'Tutor Mensajeria A' })
    profeB = await createTestUser({ nombre: 'Profe Mensajeria B' })
    await asignarRol(directora.id, centroA.id, 'admin')
    await asignarRol(directora.id, centroB.id, 'admin')
    await asignarRol(usuario.id, centroA.id, 'profe')
    await asignarProfeAula(usuario.id, aulaA.id)
    await asignarRol(usuario.id, centroB.id, 'tutor_legal')
    await crearVinculo(ninoB.id, usuario.id, 'tutor_legal_principal', {
      puede_recibir_mensajes: true,
    })
    await asignarRol(tutorA.id, centroA.id, 'tutor_legal')
    await crearVinculo(ninoA.id, tutorA.id, 'tutor_legal_principal', {
      puede_recibir_mensajes: true,
    })
    await asignarRol(profeB.id, centroB.id, 'profe')
    await asignarProfeAula(profeB.id, aulaB.id)

    // Un mensaje sin leer para el usuario en cada centro, y un anuncio de centro en cada uno.
    convA = await insertar('conversaciones', { nino_id: ninoA.id, centro_id: centroA.id })
    convB = await insertar('conversaciones', { nino_id: ninoB.id, centro_id: centroB.id })
    await insertar('mensajes', { conversacion_id: convA, autor_id: tutorA.id, contenido: 'en A' })
    await insertar('mensajes', { conversacion_id: convB, autor_id: profeB.id, contenido: 'en B' })
    anuncioA = await insertar('anuncios', {
      autor_id: directora.id,
      centro_id: centroA.id,
      ambito: 'centro',
      aula_id: null,
      titulo: 'Aviso A',
      contenido: 'aviso del centro A',
    })
    anuncioB = await insertar('anuncios', {
      autor_id: directora.id,
      centro_id: centroB.id,
      ambito: 'centro',
      aula_id: null,
      titulo: 'Aviso B',
      contenido: 'aviso del centro B',
    })

    cUsuario = await clientFor(usuario)
    cDirectora = await clientFor(directora)
  }, 120_000)

  afterAll(async () => {
    sesion.actual = null
    const usuarios = [directora, usuario, tutorA, profeB]
      .map((u) => u?.id)
      .filter((u): u is string => Boolean(u))
    await serviceClient.from('lectura_anuncio').delete().in('usuario_id', usuarios)
    await serviceClient.from('lectura_conversacion').delete().in('usuario_id', usuarios)
    await serviceClient.from('anuncios').delete().in('autor_id', usuarios)
    await serviceClient.from('mensajes').delete().in('autor_id', usuarios)
    await serviceClient.from('vinculos_familiares').delete().in('usuario_id', usuarios)
    await serviceClient.from('profes_aulas').delete().in('profe_id', usuarios)
    for (const c of [centroA, centroB]) if (c) await deleteTestCentro(c.id)
    for (const u of usuarios) await deleteTestUser(u)
  }, 120_000)

  it('premisa: sin acotar, la RLS deja ver lo de los dos centros', async () => {
    const { data: convs } = await cUsuario.from('conversaciones').select('id')
    expect((convs ?? []).map((c) => c.id).sort()).toEqual([convA, convB].sort())
    const { data: anuncios } = await cUsuario.from('anuncios').select('id')
    expect((anuncios ?? []).map((a) => a.id).sort()).toEqual([anuncioA, anuncioB].sort())
    const { data: supervisadas } = await cDirectora
      .from('conversaciones')
      .select('id')
      .eq('tipo_conversacion', 'profe_familia')
    expect((supervisadas ?? []).map((c) => c.id).sort()).toEqual([convA, convB].sort())
  })

  it('badge de mensajes, conversaciones: un mensaje sin leer en cada centro, el suyo', async () => {
    sesion.actual = cUsuario
    expect((await countNoLeidos(centroA.id)).conversaciones).toBe(1)
    expect((await countNoLeidos(centroB.id)).conversaciones).toBe(1)
  })

  it('badge de mensajes, anuncios: un anuncio sin leer en cada centro, el suyo', async () => {
    sesion.actual = cUsuario
    expect((await countNoLeidos(centroA.id)).anuncios).toBe(1)
    expect((await countNoLeidos(centroB.id)).anuncios).toBe(1)
  })

  it('lista de anuncios de /messages: solo los del centro', async () => {
    sesion.actual = cUsuario
    expect((await getAnunciosDelUsuario(centroA.id)).map((a) => a.id)).toEqual([anuncioA])
    expect((await getAnunciosDelUsuario(centroB.id)).map((a) => a.id)).toEqual([anuncioB])
  })

  it('detalle de un anuncio por URL: el de B no se abre en A; en B, sí', async () => {
    sesion.actual = cUsuario
    expect(await getAnuncioDetalle(anuncioB, centroA.id)).toBeNull()
    expect((await getAnuncioDetalle(anuncioB, centroB.id))?.id).toBe(anuncioB)
    expect((await getAnuncioDetalle(anuncioA, centroA.id))?.id).toBe(anuncioA)
  })

  it('supervisión de la directora: solo las conversaciones del centro', async () => {
    sesion.actual = cDirectora
    expect((await getConversacionesDelUsuario(centroA.id)).map((c) => c.id)).toEqual([convA])
    expect((await getConversacionesDelUsuario(centroB.id)).map((c) => c.id)).toEqual([convB])
  })
})
