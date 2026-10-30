import { randomInt } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  anonClient,
  asignarRol,
  clientFor,
  createTestCentro,
  createTestUser,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

import { registrarPasada, type RecuentosPasada } from '@/features/retencion/lib/pasadas'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/types/database'

/**
 * El registro de cada pasada del cron de retención (20261213120000), contra la BD:
 *   · `registrarPasada` deja la fila, en modo simulado o purgado, con las doce claves.
 *   · El CHECK exige las doce claves y el modo es el tipo `retencion_accion`.
 *   · service_role inserta y lee, y no puede cambiar ni borrar una pasada (42501).
 *   · Las sesiones (también la admin del centro) y anon no tienen ningún privilegio (42501).
 * La tabla solo crece: estas filas se quedan en la BD efímera.
 */

function recuentos(marca: number): RecuentosPasada {
  return {
    olvido: { total: marca, purgados: 0, fallidos: 0 },
    retencion: { dryRun: true, total: 0, objetosPurgados: 0, fallidos: 0, porCategoria: {} },
    lecturasFichaMedica: { dryRun: true, lecturas: 0 },
    auditLog: { dryRun: true, filas: 0 },
    exportLog: { dryRun: true, filas: null },
    listaEspera: { dryRun: true, prospectos: 0 },
    operativa: { dryRun: true, filas: null },
    expediente: { dryRun: true, vencidos: 0, purgados: 0, fallidos: 0 },
    firmas: { dryRun: true, vencidos: 0, destruidas: {}, fallidos: 0 },
    cuentas: { dryRun: true, vencidas: 0, purgadas: 0, fallidas: 0, consentimientosCuenta: 0 },
    fiscal: { dryRun: true, vencidas: 0, destruidas: 0, fallidas: 0 },
    cuentasOlvidadas: {
      dryRun: true,
      candidatas: 0,
      borradas: 0,
      esperan: 0,
      auth: { pendientes: 0, borradas: 0, fallidas: 0 },
    },
  }
}

/** Las filas con esa marca en `recuentos.olvido.total`. */
async function filasCon(marca: number) {
  const { data, error } = await serviceClient
    .from('retencion_pasadas')
    .select('id, modo, recuentos, ejecutada_en')
    .eq('recuentos->olvido->>total', String(marca))
  if (error) throw new Error(`leer retencion_pasadas: ${error.message}`)
  return data
}

describe('retencion_pasadas', () => {
  let admin: TestUser
  let sesion: SupabaseClient<Database>

  beforeAll(async () => {
    const centro = await createTestCentro('Centro Pasadas Retencion')
    admin = await createTestUser({ nombre: 'Admin Pasadas Retencion' })
    await asignarRol(admin.id, centro.id, 'admin')
    sesion = await clientFor(admin)
  })

  afterAll(async () => {
    if (admin) await deleteTestUser(admin.id)
  })

  it('premisa: registrarPasada deja una fila simulada con las doce claves', async () => {
    const marca = randomInt(1e9)
    expect(await filasCon(marca)).toHaveLength(0)

    expect(await registrarPasada(serviceClient, true, recuentos(marca))).toBe(true)

    const filas = await filasCon(marca)
    expect(filas).toHaveLength(1)
    expect(filas[0].modo).toBe('simulado')
    expect(Object.keys(filas[0].recuentos as object).sort()).toEqual(
      Object.keys(recuentos(0)).sort()
    )
  })

  it('en real, la fila dice purgado', async () => {
    const marca = randomInt(1e9)
    expect(await registrarPasada(serviceClient, false, recuentos(marca))).toBe(true)
    const filas = await filasCon(marca)
    expect(filas.map((f) => f.modo)).toEqual(['purgado'])
  })

  it('sin una de las doce claves, el CHECK la rechaza y registrarPasada devuelve false', async () => {
    const marca = randomInt(1e9)
    const sinUna: Partial<RecuentosPasada> = recuentos(marca)
    delete sinUna.cuentasOlvidadas
    const { error } = await serviceClient
      .from('retencion_pasadas')
      .insert({ modo: 'simulado', recuentos: sinUna as unknown as Json })
    expect(error?.code).toBe('23514')

    expect(await registrarPasada(serviceClient, true, sinUna as RecuentosPasada)).toBe(false)
    expect(await filasCon(marca)).toHaveLength(0)
  })

  it('el modo es simulado o purgado', async () => {
    const { error } = await serviceClient.from('retencion_pasadas').insert({
      modo: 'borrado' as 'purgado',
      recuentos: recuentos(randomInt(1e9)) as unknown as Json,
    })
    expect(error?.code).toBe('22P02')
  })

  it('service_role no cambia ni borra una pasada', async () => {
    const marca = randomInt(1e9)
    expect(await registrarPasada(serviceClient, true, recuentos(marca))).toBe(true)
    const [fila] = await filasCon(marca)

    const upd = await serviceClient
      .from('retencion_pasadas')
      .update({ modo: 'purgado' })
      .eq('id', fila.id)
    expect(upd.error?.code).toBe('42501')

    const del = await serviceClient.from('retencion_pasadas').delete().eq('id', fila.id)
    expect(del.error?.code).toBe('42501')

    expect((await filasCon(marca)).map((f) => f.modo)).toEqual(['simulado'])
  })

  it('una sesión, también la admin del centro, no lee ni escribe la tabla', async () => {
    const lee = await sesion.from('retencion_pasadas').select('id').limit(1)
    expect(lee.error?.code).toBe('42501')

    const escribe = await sesion
      .from('retencion_pasadas')
      .insert({ modo: 'simulado', recuentos: recuentos(randomInt(1e9)) as unknown as Json })
    expect(escribe.error?.code).toBe('42501')
  })

  it('anon no lee la tabla', async () => {
    const { error } = await anonClient().from('retencion_pasadas').select('id').limit(1)
    expect(error?.code).toBe('42501')
  })
})
