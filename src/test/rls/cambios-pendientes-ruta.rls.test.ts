import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestNino,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestNino,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'

/**
 * Seguridad R1/R1b — la ruta del documento staged de `cambios_pendientes` debe ser del propio
 * niño de la fila.
 *
 * Migración: 20261003120000_fix_cambios_pendientes_ruta_documento
 *   CHECK `cambios_pendientes_ruta_documento_del_nino`: para `ninos_libro_familia` y
 *   `datos_tutor_dni`, `payload->>'path'` = `{centro_id}/{nino_id}/<nombre>.pdf`.
 *
 * El agujero: la policy de INSERT solo pide `es_tutor_legal_de(nino_id)`, así que un tutor
 * podía encolar por PostgREST la ruta del libro de familia o del DNI de OTRA familia/centro;
 * al rechazar, la app la borraba con service role. Aquí se ataca por PostgREST con el cliente
 * del tutor (el camino del atacante) y se comprueba que la BD lo para (23514), que el flujo
 * legítimo sigue y que un admin tampoco puede reescribir el payload a una ruta ajena.
 *
 * No toca Storage: solo inserta filas en la cola. El "no borra" de la app lo cubren los tests
 * unitarios de `descartarCambioPendiente`.
 *
 * Gateado (la migración la aplica Jose a mano): CAMBIOS_PENDIENTES_RUTA_APPLIED=1
 */

const MIGRATION_APPLIED = process.env.CAMBIOS_PENDIENTES_RUTA_APPLIED === '1'

type Client = SupabaseClient<Database>

describe.skipIf(!MIGRATION_APPLIED)('cambios_pendientes — ruta del documento del niño', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let ninoA: TestNino // de tutorA
  let ninoB: TestNino // otro centro, otra familia
  let tutorA: TestUser
  let adminA: TestUser
  let cTutorA: Client
  let cAdminA: Client

  const encolar = (entidad: string, payload: Json, centroId?: string) =>
    cTutorA
      .from('cambios_pendientes')
      .insert({
        centro_id: centroId ?? centroA.id,
        nino_id: ninoA.id,
        entidad,
        registro_id: ninoA.id,
        payload,
        solicitado_por: tutorA.id,
      })
      .select('id')
      .maybeSingle()

  beforeAll(async () => {
    centroA = await createTestCentro('Centro A Ruta')
    centroB = await createTestCentro('Centro B Ruta')
    ninoA = await createTestNino(centroA.id, 'Nino A Ruta')
    ninoB = await createTestNino(centroB.id, 'Nino B Ruta')
    tutorA = await createTestUser({ nombre: 'Tutor A Ruta' })
    adminA = await createTestUser({ nombre: 'Admin A Ruta' })
    await asignarRol(tutorA.id, centroA.id, 'tutor_legal')
    await asignarRol(adminA.id, centroA.id, 'admin')
    await crearVinculo(ninoA.id, tutorA.id, 'tutor_legal_principal')
    cTutorA = await clientFor(tutorA)
    cAdminA = await clientFor(adminA)
  }, 90_000)

  afterAll(async () => {
    await serviceClient.from('cambios_pendientes').delete().eq('nino_id', ninoA.id)
    for (const u of [tutorA, adminA]) await deleteTestUser(u.id)
    for (const c of [centroA, centroB]) await deleteTestCentro(c.id)
  }, 90_000)

  const rutaPropia = (nombre: string) => `${centroA.id}/${ninoA.id}/${nombre}`

  it('flujo legítimo: el tutor encola su libro de familia y su DNI con la ruta de su niño', async () => {
    const libro = await encolar('ninos_libro_familia', { path: rutaPropia(`${randomUUID()}.pdf`) })
    expect(libro.error).toBeNull()
    expect(libro.data).not.toBeNull()

    const dni = await encolar('datos_tutor_dni', {
      tipo_vinculo: 'tutor_legal_principal',
      path: rutaPropia(`dni-tutor_legal_principal-${randomUUID()}.pdf`),
    })
    expect(dni.error).toBeNull()
    expect(dni.data).not.toBeNull()
  })

  it('un parche de datos (sin documento) no se ve afectado', async () => {
    const r = await encolar('ninos_familia', { direccion_calle: 'Calle Ruta' })
    expect(r.error).toBeNull()
  })

  it.each([
    [
      'libro de familia de otro centro/familia',
      'ninos_libro_familia',
      () => `${centroB.id}/${ninoB.id}/libro.pdf`,
    ],
    [
      'libro de otro niño del mismo centro',
      'ninos_libro_familia',
      () => `${centroA.id}/${ninoB.id}/libro.pdf`,
    ],
    [
      'escapa del prefijo con ..',
      'ninos_libro_familia',
      () => `${centroA.id}/${ninoA.id}/../../${centroB.id}/${ninoB.id}/libro.pdf`,
    ],
    ['DNI de otro centro/familia', 'datos_tutor_dni', () => `${centroB.id}/${ninoB.id}/dni.pdf`],
  ] as const)(
    'el tutor NO puede encolar una ruta ajena: %s (23514)',
    async (_caso, entidad, ruta) => {
      const payload =
        entidad === 'datos_tutor_dni'
          ? { tipo_vinculo: 'tutor_legal_principal', path: ruta() }
          : { path: ruta() }
      const r = await encolar(entidad, payload)
      expect(r.error?.code).toBe('23514')
      expect(r.data).toBeNull()
    }
  )

  it('sin path en un documento → 23514 (no pasa por NULL)', async () => {
    const r = await encolar('ninos_libro_familia', {})
    expect(r.error?.code).toBe('23514')
  })

  it('falsear centro_id no sirve: el trigger lo fija desde el niño', async () => {
    const r = await encolar(
      'ninos_libro_familia',
      { path: `${centroB.id}/${ninoA.id}/libro.pdf` },
      centroB.id
    )
    expect(r.error?.code).toBe('23514')
  })

  it('el admin decide normal y NO puede reescribir el payload a una ruta ajena', async () => {
    const pend = await encolar('ninos_libro_familia', { path: rutaPropia(`${randomUUID()}.pdf`) })
    expect(pend.error).toBeNull()
    const id = pend.data!.id

    const reescrito = await cAdminA
      .from('cambios_pendientes')
      .update({ payload: { path: `${centroB.id}/${ninoB.id}/libro.pdf` } })
      .eq('id', id)
      .select('id')
      .maybeSingle()
    expect(reescrito.error?.code).toBe('23514')

    const rechazado = await cAdminA
      .from('cambios_pendientes')
      .update({
        estado: 'rechazado',
        revisado_por: adminA.id,
        decided_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('estado', 'pendiente')
      .select('id, centro_id, nino_id, payload')
      .maybeSingle()
    expect(rechazado.error).toBeNull()
    expect(rechazado.data?.centro_id).toBe(centroA.id)
    expect(
      (rechazado.data?.payload as { path: string }).path.startsWith(`${centroA.id}/${ninoA.id}/`)
    ).toBe(true)
  })
})
