import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  anonClient,
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestFamilia,
  createTestUser,
  crearFamiliaTutor,
  deleteTestCentro,
  deleteTestUser,
  type TestAula,
  type TestCentro,
  type TestUser,
  serviceClient,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * PR 2b (Fase 4) — las 25 funciones auxiliares de las policies, fuera de la API.
 *
 * Migración: 20261028120000_fix_funciones_esquema_privado
 *   - Las 25 (`centro_de_*`, `autor_de_publicacion`, `organizador_de_cita`, `ruta_coherente`…)
 *     pasan de `public` al esquema `privado`, que PostgREST no expone: por RPC, nadie las
 *     encuentra (PGRST202), ni con sesión ni con service role.
 *   - Las policies las siguen por su oid y los 42 cuerpos que las llamaban se recrean con
 *     `privado.`: lo que filtraban sigue igual (anclas de abajo).
 *   - `authenticated` conserva USAGE y EXECUTE: las policies se evalúan con su rol, y tres
 *     triggers son de invocador.
 *
 * El control positivo (commit f37e6b4) demostró contra la BD efímera que una directora de otro
 * centro y una cuenta sin centro llegaban a las 25 por la API y les contestaban sobre B.
 */

// Cliente sin tipar: las 25 ya no están en los tipos generados.
type Client = SupabaseClient

let centroA: TestCentro
let centroB: TestCentro
let aulaB: TestAula
let familiaB: string
let ninoB: string
let directoraA: TestUser
let directoraB: TestUser
let tutorB: TestUser
let sinCentro: TestUser
let cliDirectoraA: Client
let cliDirectoraB: Client
let cliSinCentro: Client
let anuncioB: string | undefined

const id = () => randomUUID()

/**
 * Las 25, con argumentos de relleno. PGRST202 también sale con un nombre o un argumento mal
 * escrito: que estas mismas llamadas llegaran a la función antes del arreglo (control positivo)
 * es lo que hace que aquí midan el arreglo y no una errata.
 */
const LAS_25: Array<[string, () => Record<string, unknown>]> = [
  ['aula_de_publicacion', () => ({ p_publicacion_id: id() })],
  ['autor_de_publicacion', () => ({ p_publicacion_id: id() })],
  ['autorizacion_aplica_a_nino', () => ({ p_autorizacion_id: id(), p_nino_id: id() })],
  ['autorizacion_firmable', () => ({ p_autorizacion_id: id() })],
  [
    'autorizacion_plantilla_valida',
    () => ({ p_plantilla_id: id(), p_centro_id: id(), p_tipo: 'medicacion' }),
  ],
  ['centro_de_agenda', () => ({ p_agenda_id: id() })],
  ['centro_de_aula', () => ({ p_aula_id: id() })],
  ['centro_de_cita', () => ({ p_cita_id: id() })],
  ['centro_de_concepto', () => ({ p_concepto_id: id() })],
  ['centro_de_evento', () => ({ p_evento_id: id() })],
  ['centro_de_familia', () => ({ p_familia_id: id() })],
  ['centro_de_nino', () => ({ p_nino_id: id() })],
  ['centro_de_plantilla', () => ({ p_plantilla_id: id() })],
  ['centro_de_publicacion', () => ({ p_publicacion_id: id() })],
  ['centro_de_recibo', () => ({ p_recibo_id: id() })],
  ['conversacion_activa', () => ({ p_conv_id: id() })],
  ['evento_aplica_a_nino', () => ({ p_evento_id: id(), p_nino_id: id() })],
  ['familia_de_recibo', () => ({ p_recibo_id: id() })],
  ['fecha_de_agenda', () => ({ p_agenda_id: id() })],
  ['medicacion_administrable_hoy', () => ({ p_autorizacion_id: id() })],
  ['nino_de_agenda', () => ({ p_agenda_id: id() })],
  ['nino_puede_aparecer', () => ({ p_nino_id: id() })],
  ['organizador_de_cita', () => ({ p_cita_id: id() })],
  ['publicacion_de_media', () => ({ p_media_id: id() })],
  ['ruta_coherente', () => ({ p_bucket: 'dni-tutores', p_name: `${id()}/${id()}/dni.pdf` })],
]

/** El ataque con ids reales de B: antes contestaban a quien no es de B. */
const ORACULOS: Array<[string, () => Record<string, unknown>]> = [
  ['centro_de_nino', () => ({ p_nino_id: ninoB })],
  ['centro_de_familia', () => ({ p_familia_id: familiaB })],
  ['centro_de_aula', () => ({ p_aula_id: aulaB.id })],
  ['ruta_coherente', () => ({ p_bucket: 'dni-tutores', p_name: `${centroB.id}/${ninoB}/dni.pdf` })],
]

beforeAll(async () => {
  centroA = await createTestCentro('Privado A')
  centroB = await createTestCentro('Privado B')
  const cursoB = await createTestCurso(centroB.id)
  aulaB = await createTestAula(centroB.id, cursoB.id)
  familiaB = await createTestFamilia(centroB.id)
  const { data: nino, error } = await serviceClient
    .from('ninos')
    .insert({
      centro_id: centroB.id,
      familia_id: familiaB,
      nombre: `Hijo-${randomUUID().slice(0, 8)}`,
      apellidos: 'Apellido Test',
      fecha_nacimiento: '2024-03-15',
    })
    .select('id')
    .single()
  if (error || !nino) throw new Error(`sembrar niño falló: ${error?.message}`)
  ninoB = nino.id

  directoraA = await createTestUser({ nombre: 'Directora A Privado' })
  await asignarRol(directoraA.id, centroA.id, 'admin')
  cliDirectoraA = (await clientFor(directoraA)) as unknown as Client
  sinCentro = await createTestUser({ nombre: 'Sin Centro Privado' })
  cliSinCentro = (await clientFor(sinCentro)) as unknown as Client

  // Centro B: su directora y el tutor titular de la familia (para las anclas).
  directoraB = await createTestUser({ nombre: 'Directora B Privado' })
  await asignarRol(directoraB.id, centroB.id, 'admin')
  cliDirectoraB = (await clientFor(directoraB)) as unknown as Client
  tutorB = await createTestUser({ nombre: 'Tutor B Privado' })
  await asignarRol(tutorB.id, centroB.id, 'tutor_legal')
  await crearFamiliaTutor(familiaB, tutorB.id, 'titular')
}, 120_000)

afterAll(async () => {
  if (anuncioB) await serviceClient.from('anuncios').delete().eq('id', anuncioB)
  for (const u of [directoraA, directoraB, tutorB, sinCentro]) if (u) await deleteTestUser(u.id)
  await deleteTestCentro(centroA.id)
  await deleteTestCentro(centroB.id)
}, 120_000)

describe('PR 2b — las funciones auxiliares de las policies, fuera de la API', () => {
  it('premisa: el niño, la familia y el aula son de B, y ninguno de los dos atacantes tiene rol en B', async () => {
    const { data: n } = await serviceClient
      .from('ninos')
      .select('centro_id')
      .eq('id', ninoB)
      .single()
    expect(n?.centro_id).toBe(centroB.id)
    const { data: f } = await serviceClient
      .from('familias')
      .select('centro_id')
      .eq('id', familiaB)
      .single()
    expect(f?.centro_id).toBe(centroB.id)
    expect(aulaB.centro_id).toBe(centroB.id)
    const { count } = await serviceClient
      .from('roles_usuario')
      .select('id', { count: 'exact', head: true })
      .in('usuario_id', [directoraA.id, sinCentro.id])
      .eq('centro_id', centroB.id)
    expect(count).toBe(0)
  })

  it('son 25 funciones distintas, y los oráculos están entre ellas', () => {
    const nombres = new Set(LAS_25.map(([n]) => n))
    expect(nombres.size).toBe(25)
    for (const [n] of ORACULOS) expect(nombres.has(n), n).toBe(true)
  })

  it.each(LAS_25)(
    'nadie llega a %s por la API: ni anon, ni con sesión, ni el servicio (PGRST202)',
    async (nombre, args) => {
      for (const c of [
        anonClient() as unknown as Client,
        cliSinCentro,
        serviceClient as unknown as Client,
      ]) {
        const { data, error } = await c.rpc(nombre, args())
        expect(error?.code).toBe('PGRST202')
        expect(data).toBeNull()
      }
    }
  )

  it.each(ORACULOS)(
    '%s ya no contesta sobre B a la directora de A ni a una cuenta sin centro',
    async (nombre, args) => {
      for (const c of [cliDirectoraA, cliSinCentro]) {
        const { data, error } = await c.rpc(nombre, args())
        expect(error?.code).toBe('PGRST202')
        expect(data).toBeNull()
      }
    }
  )

  // Lo que muerde esta es config.toml: `privado` no está entre los esquemas expuestos.
  it('pedir el esquema privado a la API se rechaza (PGRST106)', async () => {
    for (const c of [cliDirectoraA, serviceClient as unknown as Client]) {
      const { data, error } = await c.schema('privado').rpc('centro_de_nino', { p_nino_id: ninoB })
      expect(error?.code).toBe('PGRST106')
      expect(data).toBeNull()
    }
  })

  it('ancla: la policy sigue a la función movida (familia_tutores_select, es_admin(centro_de_familia))', async () => {
    const { data: deB, error: eB } = await cliDirectoraB
      .from('familia_tutores')
      .select('id')
      .eq('familia_id', familiaB)
    expect(eB).toBeNull()
    expect(deB).toHaveLength(1)
    const { data: deA, error: eA } = await cliDirectoraA
      .from('familia_tutores')
      .select('id')
      .eq('familia_id', familiaB)
    expect(eA).toBeNull()
    expect(deA).toHaveLength(0)
  })

  it('ancla: un trigger de invocador llama a privado con la sesión (anuncios_validar_aula_centro)', async () => {
    const { data, error } = await cliDirectoraB
      .from('anuncios')
      .insert({
        centro_id: centroB.id,
        autor_id: directoraB.id,
        ambito: 'aula',
        aula_id: aulaB.id,
        titulo: 'Anuncio de prueba',
        contenido: 'Contenido de prueba',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    anuncioB = data?.id
    expect(anuncioB).toBeTruthy()
  })
})
