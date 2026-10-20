import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * La identidad de una autorización no cambia: tipo, plantilla o instancia, alcance (niño, aula,
 * evento), centro, plantilla de la que sale y autor.
 *
 * `autorizaciones_update` deja a quien creó la fila cambiarla entera mientras nadie la firme
 * (`creado_por = auth.uid()` en USING y WITH CHECK; `bloquea_texto_tras_firma` solo congela
 * con firmas). Quien crea son la directora, la profe (salidas de su aula) y la familia
 * (recogida y medicación de su hijo, desde la plantilla). Así, una familia convertía su recogida
 * en las normas del centro para todo el centro, o se la llevaba a otro centro, y una profe
 * convertía su salida en la plantilla de las normas del centro.
 *
 * Las instancias se crean con la sesión de cada uno, por el camino real de la app.
 */

type Client = SupabaseClient<Database>
type AutorizacionUpdate = Database['public']['Tables']['autorizaciones']['Update']

const TEXTO = 'Texto legal de prueba, definitivo.'

let centroA: { id: string }
let centroB: { id: string }
let admin: TestUser
let profe: TestUser
let tutor: TestUser
let cliAdmin: Client
let cliProfe: Client
let cliTutor: Client
let ninoA: string
let ninoB: string
let evento: string
let plantillaRecogida: string
const creadas: string[] = []

beforeAll(async () => {
  centroA = await createTestCentro('Centro A Identidad')
  centroB = await createTestCentro('Centro B Identidad')
  const cursoA = await createTestCurso(centroA.id)
  const cursoB = await createTestCurso(centroB.id)
  const aulaA = await createTestAula(centroA.id, cursoA.id, 'Aula A Identidad')
  const aulaB = await createTestAula(centroB.id, cursoB.id, 'Aula B Identidad')
  ninoA = (await createTestNino(centroA.id, 'Nino A Identidad')).id
  ninoB = (await createTestNino(centroB.id, 'Nino B Identidad')).id
  await matricular(ninoA, aulaA.id, cursoA.id)
  await matricular(ninoB, aulaB.id, cursoB.id)

  admin = await createTestUser({ nombre: 'Admin Identidad' })
  profe = await createTestUser({ nombre: 'Profe Identidad' })
  tutor = await createTestUser({ nombre: 'Tutor Identidad' })
  await asignarRol(admin.id, centroA.id, 'admin')
  await asignarRol(profe.id, centroA.id, 'profe')
  await asignarRol(tutor.id, centroA.id, 'tutor_legal')
  await asignarProfeAula(profe.id, aulaA.id)
  await crearVinculo(ninoA, tutor.id, 'tutor_legal_principal', {
    puede_firmar_autorizaciones: true,
  })
  cliAdmin = await clientFor(admin)
  cliProfe = await clientFor(profe)
  cliTutor = await clientFor(tutor)

  const { data: ev, error: evErr } = await serviceClient
    .from('eventos')
    .insert({
      ambito: 'aula',
      centro_id: centroA.id,
      aula_id: aulaA.id,
      tipo: 'excursion',
      titulo: 'Excursión Identidad',
      fecha: '2026-11-15',
      creado_por: admin.id,
    })
    .select('id')
    .single()
  if (evErr || !ev) throw new Error(`evento: ${evErr?.message}`)
  evento = ev.id

  const { data: pl, error: plErr } = await serviceClient
    .from('autorizaciones')
    .insert({
      centro_id: centroA.id,
      tipo: 'recogida',
      es_plantilla: true,
      titulo: 'Formato recogida',
      texto: TEXTO,
      texto_version: 'v1',
      texto_definitivo: true,
      estado: 'publicada',
      creado_por: admin.id,
    })
    .select('id')
    .single()
  if (plErr || !pl) throw new Error(`plantilla: ${plErr?.message}`)
  plantillaRecogida = pl.id
  creadas.push(pl.id)
}, 120_000)

afterAll(async () => {
  for (const id of creadas.reverse())
    await serviceClient.from('autorizaciones').delete().eq('id', id)
  if (evento) await serviceClient.from('eventos').delete().eq('id', evento)
  for (const u of [admin, profe, tutor]) if (u) await deleteTestUser(u.id)
  await deleteTestCentro(centroA.id)
  await deleteTestCentro(centroB.id)
}, 60_000)

/** La recogida que la familia crea desde la plantilla, con su sesión (B2). */
async function recogidaDeLaFamilia(): Promise<string> {
  const { data, error } = await cliTutor
    .from('autorizaciones')
    .insert({
      centro_id: centroA.id,
      tipo: 'recogida',
      es_plantilla: false,
      ambito: 'nino',
      nino_id: ninoA,
      plantilla_id: plantillaRecogida,
      titulo: 'Recogida de la familia',
      texto: TEXTO,
      texto_version: 'v1',
      texto_definitivo: true,
      estado: 'publicada',
      creado_por: tutor.id,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`la familia no creó su recogida: ${error?.message}`)
  creadas.push(data.id)
  return data.id
}

/** La salida que la profe crea para un evento de su aula, con su sesión. */
async function salidaDeLaProfe(): Promise<string> {
  const { data, error } = await cliProfe
    .from('autorizaciones')
    .insert({
      centro_id: centroA.id,
      tipo: 'salida',
      es_plantilla: false,
      evento_id: evento,
      titulo: 'Salida de la profe',
      texto: 'PENDIENTE',
      texto_version: 'v0-pendiente',
      texto_definitivo: false,
      estado: 'borrador',
      creado_por: profe.id,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`la profe no creó su salida: ${error?.message}`)
  creadas.push(data.id)
  return data.id
}

async function cambiar(cli: Client, id: string, cambio: AutorizacionUpdate) {
  return cli.from('autorizaciones').update(cambio).eq('id', id).select('id').maybeSingle()
}

describe('la familia, sobre su recogida sin firmar', () => {
  it('ancla: sigue pudiendo editar el título', async () => {
    const id = await recogidaDeLaFamilia()
    const { data, error } = await cambiar(cliTutor, id, { titulo: 'Recogida (corregida)' })
    expect(error).toBeNull()
    expect(data?.id).toBe(id)
  })

  it('no le cambia el tipo', async () => {
    const id = await recogidaDeLaFamilia()
    const { error } = await cambiar(cliTutor, id, { tipo: 'medicacion' })
    expect(error?.code).toBe('23514')
  })

  it('no la pasa a otro niño', async () => {
    const id = await recogidaDeLaFamilia()
    const { error } = await cambiar(cliTutor, id, { nino_id: ninoB })
    expect(error?.code).toBe('23514')
  })

  it('no se la lleva a otro centro', async () => {
    const id = await recogidaDeLaFamilia()
    const { error } = await cambiar(cliTutor, id, { centro_id: centroB.id })
    expect(error?.code).toBe('23514')
  })

  it('no la convierte en las normas del centro para todo el centro', async () => {
    const id = await recogidaDeLaFamilia()
    const { error } = await cambiar(cliTutor, id, {
      tipo: 'reglas_regimen_interno',
      ambito: 'centro',
      nino_id: null,
    })
    expect(error?.code).toBe('23514')
  })
})

describe('la profe, sobre su salida sin firmar', () => {
  it('ancla: sigue pudiendo editar el título', async () => {
    const id = await salidaDeLaProfe()
    const { data, error } = await cambiar(cliProfe, id, { titulo: 'Salida (corregida)' })
    expect(error).toBeNull()
    expect(data?.id).toBe(id)
  })

  it('no se la lleva a otro centro', async () => {
    const id = await salidaDeLaProfe()
    const { error } = await cambiar(cliProfe, id, { centro_id: centroB.id })
    expect(error?.code).toBe('23514')
  })

  it('no la convierte en la plantilla de las normas del centro', async () => {
    const id = await salidaDeLaProfe()
    const { error } = await cambiar(cliProfe, id, {
      tipo: 'reglas_regimen_interno',
      es_plantilla: true,
      evento_id: null,
    })
    expect(error?.code).toBe('23514')
  })
})

describe('tampoco la dirección', () => {
  it('no le cambia el tipo a una plantilla', async () => {
    const { error } = await cambiar(cliAdmin, plantillaRecogida, { tipo: 'medicacion' })
    expect(error?.code).toBe('23514')
  })
})
