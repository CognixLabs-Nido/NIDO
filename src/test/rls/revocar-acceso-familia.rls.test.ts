import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestFamilia,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * F-3-C-3 — RPC `revocar_acceso_familia` (primitivo de pérdida de acceso familiar).
 *
 *  1. happy path: familia sin niños activos → familias.deleted_at + roles_usuario
 *     (tutor_legal) de los 2 tutores con cuenta soft-borrados.
 *  2. guard: familia con un niño ACTIVO → no-op ('tiene_ninos_activos').
 *  3. idempotencia: 2.ª llamada sobre familia ya inactiva → ya_inactiva:true, 0 cambios.
 *  4. usuario_id NULL: un familia_tutor sin cuenta no aporta rol → solo se revoca el otro.
 *  5. authz: profe/tutor denegados; admin de otro centro denegado; service_role OK.
 *     (admin del centro OK lo cubre el happy path.)
 *  6. atomicidad: una llamada que falla (no autorizada) deja familia y roles intactos.
 *  7. reversibilidad: deleted_at → NULL sobre las mismas filas deja todo consistente.
 *
 * Gate: F3C3_MIGRATION_APPLIED=1 (requiere la migración 20260718120000 aplicada).
 */

const APPLIED = process.env.F3C3_MIGRATION_APPLIED === '1'
const NOW = '2026-07-11T00:00:00.000Z'

describe.skipIf(!APPLIED)('F-3-C-3 — revocar_acceso_familia (RPC)', () => {
  let centroA: { id: string }
  let centroB: { id: string }
  let adminA: TestUser
  let adminB: TestUser
  let profeA: TestUser
  let cAdminA: SupabaseClient<Database>
  let cAdminB: SupabaseClient<Database>
  let cProfeA: SupabaseClient<Database>
  const tutoresCreados: string[] = []

  beforeAll(async () => {
    centroA = await createTestCentro('Centro F3C3 A')
    centroB = await createTestCentro('Centro F3C3 B')
    adminA = await createTestUser({ nombre: 'Admin F3C3 A' })
    adminB = await createTestUser({ nombre: 'Admin F3C3 B' })
    profeA = await createTestUser({ nombre: 'Profe F3C3 A' })
    await asignarRol(adminA.id, centroA.id, 'admin')
    await asignarRol(adminB.id, centroB.id, 'admin')
    await asignarRol(profeA.id, centroA.id, 'profe')
    cAdminA = await clientFor(adminA)
    cAdminB = await clientFor(adminB)
    cProfeA = await clientFor(profeA)
  }, 60_000)

  afterAll(async () => {
    await deleteTestCentro(centroA.id)
    await deleteTestCentro(centroB.id)
    await deleteTestUser(adminA.id)
    await deleteTestUser(adminB.id)
    await deleteTestUser(profeA.id)
    for (const id of tutoresCreados) await deleteTestUser(id)
  }, 60_000)

  async function nuevoTutor(nombre: string): Promise<TestUser> {
    const u = await createTestUser({ nombre })
    tutoresCreados.push(u.id)
    await asignarRol(u.id, centroA.id, 'tutor_legal')
    return u
  }

  /**
   * Crea una familia en centroA con `nTutores` tutores CON cuenta (rol tutor_legal),
   * opcionalmente un familia_tutor SIN cuenta, y un niño. Si `ninoActivo` es false, el
   * niño y sus vínculos quedan soft-borrados (familia sin niños activos → revocable).
   */
  async function crearFamilia(opts: {
    nTutores: 1 | 2
    tutorSinCuenta?: boolean
    ninoActivo?: boolean
  }): Promise<{ familiaId: string; tutores: string[]; ninoId: string }> {
    const familiaId = await createTestFamilia(centroA.id)
    const tutores: string[] = []
    const roles: Array<'titular' | 'segundo_tutor'> = ['titular', 'segundo_tutor']
    for (let i = 0; i < opts.nTutores; i++) {
      const t = await nuevoTutor(`Tutor ${i} de ${familiaId.slice(0, 6)}`)
      tutores.push(t.id)
      await serviceClient
        .from('familia_tutores')
        .insert({ familia_id: familiaId, usuario_id: t.id, rol_familia: roles[i]! })
    }
    if (opts.tutorSinCuenta) {
      // familia_tutor sin cuenta (invitación no aceptada) → ocupa el rol libre.
      const rolLibre = roles[opts.nTutores]!
      await serviceClient
        .from('familia_tutores')
        .insert({ familia_id: familiaId, usuario_id: null, rol_familia: rolLibre })
    }

    const { data: nino } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centroA.id,
        familia_id: familiaId,
        nombre: 'Niño F3C3',
        apellidos: 'Test',
        fecha_nacimiento: '2024-03-15',
      })
      .select('id')
      .single()
    for (const t of tutores) {
      await crearVinculo(nino!.id, t, 'tutor_legal_principal')
    }
    if (opts.ninoActivo === false) {
      await serviceClient
        .from('vinculos_familiares')
        .update({ deleted_at: NOW })
        .eq('nino_id', nino!.id)
      await serviceClient.from('ninos').update({ deleted_at: NOW }).eq('id', nino!.id)
    }
    return { familiaId, tutores, ninoId: nino!.id }
  }

  async function rolesActivos(usuarioIds: string[]): Promise<number> {
    const { data } = await serviceClient
      .from('roles_usuario')
      .select('id')
      .eq('rol', 'tutor_legal')
      .in('usuario_id', usuarioIds)
      .is('deleted_at', null)
    return (data ?? []).length
  }

  it('happy path: revoca los 2 tutores y marca la familia inactiva', async () => {
    const f = await crearFamilia({ nTutores: 2, ninoActivo: false })

    const { data, error } = await cAdminA.rpc('revocar_acceso_familia', {
      p_familia_id: f.familiaId,
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ familia_id: f.familiaId, revocado: true, roles_revocados: 2 })

    const { data: fam } = await serviceClient
      .from('familias')
      .select('deleted_at')
      .eq('id', f.familiaId)
      .single()
    expect(fam!.deleted_at).not.toBeNull()
    expect(await rolesActivos(f.tutores)).toBe(0)
  })

  it('guard: familia con un niño activo → no-op (tiene_ninos_activos)', async () => {
    const f = await crearFamilia({ nTutores: 2, ninoActivo: true })

    const { data, error } = await cAdminA.rpc('revocar_acceso_familia', {
      p_familia_id: f.familiaId,
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({
      revocado: false,
      motivo: 'tiene_ninos_activos',
      roles_revocados: 0,
    })

    const { data: fam } = await serviceClient
      .from('familias')
      .select('deleted_at')
      .eq('id', f.familiaId)
      .single()
    expect(fam!.deleted_at).toBeNull()
    expect(await rolesActivos(f.tutores)).toBe(2)
  })

  it('idempotencia: 2.ª llamada sobre familia ya inactiva → ya_inactiva:true, 0 cambios', async () => {
    const f = await crearFamilia({ nTutores: 2, ninoActivo: false })

    const first = await cAdminA.rpc('revocar_acceso_familia', { p_familia_id: f.familiaId })
    expect(first.error).toBeNull()
    expect(first.data).toMatchObject({ revocado: true, roles_revocados: 2 })

    const second = await cAdminA.rpc('revocar_acceso_familia', { p_familia_id: f.familiaId })
    expect(second.error).toBeNull()
    expect(second.data).toMatchObject({ revocado: false, ya_inactiva: true, roles_revocados: 0 })
  })

  it('usuario_id NULL: el familia_tutor sin cuenta se salta (solo revoca el que tiene cuenta)', async () => {
    const f = await crearFamilia({ nTutores: 1, tutorSinCuenta: true, ninoActivo: false })

    const { data, error } = await cAdminA.rpc('revocar_acceso_familia', {
      p_familia_id: f.familiaId,
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ revocado: true, roles_revocados: 1 })
    expect(await rolesActivos(f.tutores)).toBe(0)
  })

  it('authz: profe NO; admin de otro centro NO; service_role SÍ', async () => {
    const f = await crearFamilia({ nTutores: 2, ninoActivo: false })

    const profe = await cProfeA.rpc('revocar_acceso_familia', { p_familia_id: f.familiaId })
    expect(profe.error).not.toBeNull()
    const otroCentro = await cAdminB.rpc('revocar_acceso_familia', { p_familia_id: f.familiaId })
    expect(otroCentro.error).not.toBeNull()

    // Nada revocado por los intentos denegados.
    const { data: fam } = await serviceClient
      .from('familias')
      .select('deleted_at')
      .eq('id', f.familiaId)
      .single()
    expect(fam!.deleted_at).toBeNull()

    // service_role SÍ (ruta del cierre de curso / baja).
    const svc = await serviceClient.rpc('revocar_acceso_familia', { p_familia_id: f.familiaId })
    expect(svc.error).toBeNull()
    expect(svc.data).toMatchObject({ revocado: true, roles_revocados: 2 })
  })

  it('atomicidad: una llamada que falla (no autorizada) deja familia y roles intactos', async () => {
    const f = await crearFamilia({ nTutores: 2, ninoActivo: false })

    const { error } = await cProfeA.rpc('revocar_acceso_familia', { p_familia_id: f.familiaId })
    expect(error).not.toBeNull()

    // El fallo no aplicó ningún write parcial (RPC de una sola transacción).
    const { data: fam } = await serviceClient
      .from('familias')
      .select('deleted_at')
      .eq('id', f.familiaId)
      .single()
    expect(fam!.deleted_at).toBeNull()
    expect(await rolesActivos(f.tutores)).toBe(2)
  })

  it('reversibilidad: deleted_at → NULL sobre las mismas filas deja todo consistente', async () => {
    const f = await crearFamilia({ nTutores: 2, ninoActivo: false })

    const { data } = await cAdminA.rpc('revocar_acceso_familia', { p_familia_id: f.familiaId })
    expect(data).toMatchObject({ revocado: true, roles_revocados: 2 })
    expect(await rolesActivos(f.tutores)).toBe(0)

    // Simula el desarchivar de F-3-F: revierte deleted_at sobre las mismas filas.
    await serviceClient.from('familias').update({ deleted_at: null }).eq('id', f.familiaId)
    await serviceClient
      .from('roles_usuario')
      .update({ deleted_at: null })
      .eq('rol', 'tutor_legal')
      .in('usuario_id', f.tutores)

    const { data: fam } = await serviceClient
      .from('familias')
      .select('deleted_at')
      .eq('id', f.familiaId)
      .single()
    expect(fam!.deleted_at).toBeNull()
    expect(await rolesActivos(f.tutores)).toBe(2) // sin colisión de UNIQUE al reactivar
  })
})
