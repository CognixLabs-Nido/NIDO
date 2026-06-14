import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { clientFor, createTestUser, deleteTestUser, serviceClient, type TestUser } from './setup'

/**
 * RLS Fase 11-A (RGPD) — Activación de la tabla `consentimientos` como fuente de verdad.
 *
 * Spec: docs/specs/proteccion-datos.md (Comportamiento 2 + Decisiones #4/#13).
 * Migración: 20260613190000_phase11a_activar_consentimientos.
 *
 * Verifica: captura (RPC registrar_consentimiento) escribe la fila correcta
 * (tipo+versión) y refresca la caché de usuarios en la misma transacción; la
 * revocación (RPC revocar_consentimiento) fija revocado_en e invalida la caché;
 * re-consentimiento = fila nueva; aislamiento (un usuario no registra/revoca/lee
 * el consentimiento de otro; UPDATE directo bloqueado).
 *
 * Gateado por flag (migración aplicada a mano vía SQL Editor — CLI SIGILL):
 *   F11A_CONSENT_MIGRATION_APPLIED=1
 */

const MIGRATION_APPLIED = process.env.F11A_CONSENT_MIGRATION_APPLIED === '1'

describe.skipIf(!MIGRATION_APPLIED)('RLS consentimientos — F11-A (activación)', () => {
  let userA: TestUser
  let userB: TestUser

  beforeAll(async () => {
    userA = await createTestUser({ nombre: 'Consent A' })
    userB = await createTestUser({ nombre: 'Consent B' })
  }, 120_000)

  afterAll(async () => {
    const ids = [userA?.id, userB?.id].filter((u): u is string => Boolean(u))
    await serviceClient.from('consentimientos').delete().in('usuario_id', ids)
    for (const u of ids) await deleteTestUser(u)
  }, 60_000)

  // -------------------------------------------------------------------
  // Captura: fila correcta + caché coherente (misma transacción)
  // -------------------------------------------------------------------

  it('c01 — captura (service) escribe fila por tipo+versión y refresca la caché de usuarios', async () => {
    const { error: e1 } = await serviceClient.rpc('registrar_consentimiento', {
      p_usuario_id: userA.id,
      p_tipo: 'terminos',
      p_version: 'v1.0',
    })
    const { error: e2 } = await serviceClient.rpc('registrar_consentimiento', {
      p_usuario_id: userA.id,
      p_tipo: 'privacidad',
      p_version: 'v1.0',
    })
    expect(e1).toBeNull()
    expect(e2).toBeNull()

    const { data: filas } = await serviceClient
      .from('consentimientos')
      .select('tipo, version, revocado_en')
      .eq('usuario_id', userA.id)
      .order('tipo')
    expect(filas).toHaveLength(2)
    expect(filas).toEqual(
      expect.arrayContaining([
        { tipo: 'privacidad', version: 'v1.0', revocado_en: null },
        { tipo: 'terminos', version: 'v1.0', revocado_en: null },
      ])
    )

    const { data: u } = await serviceClient
      .from('usuarios')
      .select('consentimiento_terminos_version, consentimiento_privacidad_version')
      .eq('id', userA.id)
      .single()
    expect(u?.consentimiento_terminos_version).toBe('v1.0')
    expect(u?.consentimiento_privacidad_version).toBe('v1.0')
  })

  // -------------------------------------------------------------------
  // Lectura: self ve lo suyo, otro no
  // -------------------------------------------------------------------

  it('c02 — el usuario ve SUS consentimientos; otro usuario NO', async () => {
    const clientA = await clientFor(userA)
    const { data: propios } = await clientA
      .from('consentimientos')
      .select('id')
      .eq('usuario_id', userA.id)
    expect((propios ?? []).length).toBe(2)

    const clientB = await clientFor(userB)
    const { data: ajenos } = await clientB
      .from('consentimientos')
      .select('id')
      .eq('usuario_id', userA.id)
    expect(ajenos ?? []).toHaveLength(0)
  })

  // -------------------------------------------------------------------
  // Revocación: marca revocado_en + invalida caché
  // -------------------------------------------------------------------

  it('c03 — el usuario revoca su privacidad → revocado_en seteado + caché a NULL', async () => {
    const clientA = await clientFor(userA)
    const { data: revId, error } = await clientA.rpc('revocar_consentimiento', {
      p_tipo: 'privacidad',
    })
    expect(error).toBeNull()
    expect(revId).toBeTruthy()

    const { data: fila } = await serviceClient
      .from('consentimientos')
      .select('revocado_en')
      .eq('usuario_id', userA.id)
      .eq('tipo', 'privacidad')
      .single()
    expect(fila?.revocado_en).not.toBeNull()

    const { data: u } = await serviceClient
      .from('usuarios')
      .select('consentimiento_privacidad_version, consentimiento_terminos_version')
      .eq('id', userA.id)
      .single()
    expect(u?.consentimiento_privacidad_version).toBeNull()
    // términos intacto
    expect(u?.consentimiento_terminos_version).toBe('v1.0')
  })

  it('c04 — revocar de nuevo el mismo tipo es idempotente (no hay vigente → NULL)', async () => {
    const clientA = await clientFor(userA)
    const { data: revId, error } = await clientA.rpc('revocar_consentimiento', {
      p_tipo: 'privacidad',
    })
    expect(error).toBeNull()
    expect(revId).toBeNull()
  })

  // -------------------------------------------------------------------
  // Re-consentimiento (#13): texto nuevo = fila nueva, vigente
  // -------------------------------------------------------------------

  it('c05 — re-consentir privacidad con versión nueva crea fila nueva y refresca caché', async () => {
    const { error } = await serviceClient.rpc('registrar_consentimiento', {
      p_usuario_id: userA.id,
      p_tipo: 'privacidad',
      p_version: 'v2.0',
    })
    expect(error).toBeNull()

    const { data: privacidad } = await serviceClient
      .from('consentimientos')
      .select('version, revocado_en')
      .eq('usuario_id', userA.id)
      .eq('tipo', 'privacidad')
      .order('aceptado_en', { ascending: false })
    // 2 filas: la revocada v1.0 + la nueva vigente v2.0
    expect(privacidad).toHaveLength(2)
    const vigente = (privacidad ?? []).find((f) => f.revocado_en === null)
    expect(vigente?.version).toBe('v2.0')

    const { data: u } = await serviceClient
      .from('usuarios')
      .select('consentimiento_privacidad_version')
      .eq('id', userA.id)
      .single()
    expect(u?.consentimiento_privacidad_version).toBe('v2.0')
  })

  // -------------------------------------------------------------------
  // Aislamiento de escritura
  // -------------------------------------------------------------------

  it('c06 — un usuario NO puede registrar consentimiento de otro (RPC lo rechaza)', async () => {
    const clientB = await clientFor(userB)
    const { error } = await clientB.rpc('registrar_consentimiento', {
      p_usuario_id: userA.id, // ← intento de suplantación
      p_tipo: 'terminos',
      p_version: 'v1.0',
    })
    expect(error).toBeTruthy()
  })

  it('c07 — UPDATE directo de consentimientos está bloqueado (sin policy UPDATE)', async () => {
    // userA intenta "des-revocar" su fila por UPDATE directo → 0 filas (default DENY).
    const clientA = await clientFor(userA)
    const { data } = await clientA
      .from('consentimientos')
      .update({ revocado_en: null })
      .eq('usuario_id', userA.id)
      .eq('tipo', 'privacidad')
      .select('id')
    expect(data ?? []).toHaveLength(0)
  })

  it('c08 — INSERT directo suplantando a otro usuario está bloqueado por WITH CHECK', async () => {
    const clientB = await clientFor(userB)
    const { error } = await clientB.from('consentimientos').insert({
      usuario_id: userA.id, // ← no es auth.uid()
      tipo: 'datos_medicos',
      version: 'v1.0',
    })
    expect(error).toBeTruthy()
    expect(error?.code).toBe('42501')
  })
})
