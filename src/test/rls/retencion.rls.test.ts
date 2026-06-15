import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestUser,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * RLS Fase 11-A6 (RGPD) — Retención por tiempo: registro `retencion_ejecuciones`.
 *
 * Spec: docs/specs/proteccion-datos.md (Comportamiento 5, Decisión #12/#6).
 * Migración: 20260615130000_phase11a6_retencion (tabla append-only + enums).
 *
 * Verifica: la dirección ve el historial de barridos de SU centro y solo el suyo
 * (aislamiento), un no-admin no ve nada, y la tabla es append-only para todos los
 * roles (sin INSERT/UPDATE/DELETE desde el cliente — solo el barrido service-role
 * escribe). El borrado real de Storage y la lógica del predicado se cubren en los
 * unit tests de `fuentes-retencion`.
 *
 * Gateado por flag (migración a mano vía SQL Editor — CLI SIGILL):
 *   F11A6_RETENCION_MIGRATION_APPLIED=1
 */

const MIGRATION_APPLIED = process.env.F11A6_RETENCION_MIGRATION_APPLIED === '1'

describe.skipIf(!MIGRATION_APPLIED)('RLS retención — F11-A6', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let adminA: TestUser
  let adminB: TestUser
  let forastero: TestUser
  const filasCreadas: string[] = []

  beforeAll(async () => {
    centroA = await createTestCentro('Centro Retencion A')
    centroB = await createTestCentro('Centro Retencion B')
    adminA = await createTestUser({ nombre: 'Admin Retencion A' })
    adminB = await createTestUser({ nombre: 'Admin Retencion B' })
    forastero = await createTestUser({ nombre: 'Forastero Retencion' })
    await asignarRol(adminA.id, centroA.id, 'admin')
    await asignarRol(adminB.id, centroB.id, 'admin')

    // El barrido (service-role) registra una ejecución en cada centro.
    const { data, error } = await serviceClient
      .from('retencion_ejecuciones')
      .insert([
        {
          categoria: 'dni_recogida',
          centro_id: centroA.id,
          ref_tipo: 'firma',
          bucket: 'recogida-adjuntos',
          objetos: 1,
          motivo: 'puntual_vencida',
          accion: 'purgado',
        },
        {
          categoria: 'foto_perfil_nino',
          centro_id: centroB.id,
          ref_tipo: 'nino',
          bucket: 'ninos-fotos',
          objetos: 2,
          motivo: 'baja_12m',
          accion: 'simulado',
        },
      ])
      .select('id')
    if (error) throw new Error(`seed retencion falló: ${error.message}`)
    filasCreadas.push(...(data ?? []).map((r) => r.id))
  })

  afterAll(async () => {
    if (filasCreadas.length > 0) {
      await serviceClient.from('retencion_ejecuciones').delete().in('id', filasCreadas)
    }
    for (const u of [adminA, adminB, forastero]) if (u) await deleteTestUser(u.id)
    await serviceClient.from('centros').delete().in('id', [centroA.id, centroB.id])
  })

  it('la dirección ve los barridos de SU centro y solo los suyos', async () => {
    const cliA = await clientFor(adminA)
    const { data, error } = await cliA.from('retencion_ejecuciones').select('id, centro_id')
    expect(error).toBeNull()
    expect(data?.length).toBe(1)
    expect(data?.[0]?.centro_id).toBe(centroA.id)
  })

  it('la dirección de otro centro NO ve los ajenos', async () => {
    const cliB = await clientFor(adminB)
    const { data } = await cliB.from('retencion_ejecuciones').select('id, centro_id')
    expect(data?.length).toBe(1)
    expect(data?.[0]?.centro_id).toBe(centroB.id)
  })

  it('un no-admin no ve ningún barrido', async () => {
    const cli = await clientFor(forastero)
    const { data } = await cli.from('retencion_ejecuciones').select('id')
    expect(data?.length ?? 0).toBe(0)
  })

  it('append-only: la dirección no puede INSERT/UPDATE/DELETE', async () => {
    const cliA = await clientFor(adminA)

    const ins = await cliA.from('retencion_ejecuciones').insert({
      categoria: 'dni_recogida',
      centro_id: centroA.id,
      bucket: 'recogida-adjuntos',
      objetos: 1,
      accion: 'purgado',
    })
    expect(ins.error).not.toBeNull()

    const upd = await cliA
      .from('retencion_ejecuciones')
      .update({ objetos: 99 })
      .eq('id', filasCreadas[0])
      .select('id')
    // RLS sin policy UPDATE → 0 filas (USING falso) o error; nunca muta.
    expect(upd.data ?? []).toHaveLength(0)

    const del = await cliA
      .from('retencion_ejecuciones')
      .delete()
      .eq('id', filasCreadas[0])
      .select('id')
    expect(del.data ?? []).toHaveLength(0)

    // La fila de A sigue intacta.
    const { data } = await serviceClient
      .from('retencion_ejecuciones')
      .select('objetos')
      .eq('id', filasCreadas[0])
      .single()
    expect(data?.objetos).toBe(1)
  })
})
