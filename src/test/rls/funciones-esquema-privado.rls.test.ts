import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestFamilia,
  createTestUser,
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
 * CONTROL POSITIVO: este fichero demuestra el ataque contra la BD efímera ANTES del arreglo. Con
 * sesión, cualquiera llama por RPC a las 25 con ids de otro centro y le contestan.
 */

// Cliente sin tipar: `ruta_coherente` no está en los tipos generados.
type Client = SupabaseClient

let centroA: TestCentro
let centroB: TestCentro
let aulaB: TestAula
let familiaB: string
let ninoB: string
let directoraA: TestUser
let sinCentro: TestUser
let cliDirectoraA: Client
let cliSinCentro: Client

const id = () => randomUUID()

/** Las 25, con argumentos de relleno. Que hoy contesten prueba los nombres y los argumentos. */
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

/** El ataque con ids reales de B: lo que contestan a quien no es de B. */
const ORACULOS: Array<[string, () => Record<string, unknown>, () => unknown]> = [
  ['centro_de_nino', () => ({ p_nino_id: ninoB }), () => centroB.id],
  ['centro_de_familia', () => ({ p_familia_id: familiaB }), () => centroB.id],
  ['centro_de_aula', () => ({ p_aula_id: aulaB.id }), () => centroB.id],
  [
    'ruta_coherente',
    () => ({ p_bucket: 'dni-tutores', p_name: `${centroB.id}/${ninoB}/dni.pdf` }),
    () => true,
  ],
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
}, 120_000)

afterAll(async () => {
  for (const u of [directoraA, sinCentro]) if (u) await deleteTestUser(u.id)
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

  it.each(LAS_25)('hoy, con sesión, se llega a %s por la API', async (nombre, args) => {
    const { error } = await cliSinCentro.rpc(nombre, args())
    expect(error).toBeNull()
  })

  it.each(ORACULOS)(
    'hoy, %s contesta sobre B a la directora de A y a una cuenta sin centro',
    async (nombre, args, esperado) => {
      for (const c of [cliDirectoraA, cliSinCentro]) {
        const { data, error } = await c.rpc(nombre, args())
        expect(error).toBeNull()
        expect(data).toBe(esperado())
      }
    }
  )
})
