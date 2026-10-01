import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  anonClient,
  asignarRol,
  clientFor,
  createTestCentro,
  createTestNino,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * Seguridad de las RPCs de consentimiento de imagen (otorgar/revocar_consentimiento_imagen).
 *
 * Migración: 20261001130000_fix_consent_imagen_rpc_seguridad
 *   1. sin EXECUTE para PUBLIC/anon;
 *   2. el gate ya no se salta con auth.uid() NULL (solo service_role o sesión directa sin JWT);
 *   3. un tutor (no admin) solo otorga en su propio nombre: p_tutor se fuerza a auth.uid().
 *
 * El caso «uid NULL por un camino con EXECUTE» y la sesión directa no se pueden provocar
 * desde PostgREST; quedaron cubiertos por el ensayo con rollback contra el remoto.
 *
 * Gateado (la migración la aplica Jose a mano): CONSENT_IMAGEN_RPC_SEGURIDAD_APPLIED=1
 */

const MIGRATION_APPLIED = process.env.CONSENT_IMAGEN_RPC_SEGURIDAD_APPLIED === '1'

describe.skipIf(!MIGRATION_APPLIED)('RPCs consentimiento de imagen — autorización', () => {
  let centro: { id: string }
  let nino: { id: string }
  let ninoAjeno: { id: string }
  let admin: TestUser
  let tutor: TestUser
  let otro: TestUser
  let tutorAjeno: TestUser

  const autorDe = async (consentId: string): Promise<string | null> => {
    const { data } = await serviceClient
      .from('consentimientos')
      .select('usuario_id')
      .eq('id', consentId)
      .single()
    return data?.usuario_id ?? null
  }
  const flagDe = async (ninoId: string): Promise<boolean | null> => {
    const { data } = await serviceClient
      .from('ninos')
      .select('puede_aparecer_en_fotos')
      .eq('id', ninoId)
      .single()
    return data?.puede_aparecer_en_fotos ?? null
  }

  beforeAll(async () => {
    centro = await createTestCentro('Consent imagen RPC seguridad')
    admin = await createTestUser({ nombre: 'Admin Consent Seg' })
    tutor = await createTestUser({ nombre: 'Tutor Consent Seg' })
    otro = await createTestUser({ nombre: 'Otro Consent Seg' })
    tutorAjeno = await createTestUser({ nombre: 'Tutor Ajeno Consent Seg' })
    await asignarRol(admin.id, centro.id, 'admin')
    nino = await createTestNino(centro.id, 'Nino Consent Seg')
    ninoAjeno = await createTestNino(centro.id, 'Nino Ajeno Consent Seg')
    await crearVinculo(nino.id, tutor.id, 'tutor_legal_principal')
    await crearVinculo(ninoAjeno.id, tutorAjeno.id, 'tutor_legal_principal')
  })

  afterAll(async () => {
    const ninoIds = [nino.id, ninoAjeno.id]
    await serviceClient.from('consentimientos').delete().in('nino_id', ninoIds)
    await serviceClient.from('vinculos_familiares').delete().in('nino_id', ninoIds)
    await serviceClient.from('ninos').delete().in('id', ninoIds)
    for (const u of [admin, tutor, otro, tutorAjeno]) await deleteTestUser(u.id)
    await deleteTestCentro(centro.id)
  })

  it('anon no puede otorgar ni revocar (sin EXECUTE → 42501)', async () => {
    const anon = anonClient()
    const otorgar = await anon.rpc('otorgar_consentimiento_imagen', {
      p_nino_id: nino.id,
      p_tutor: otro.id,
    })
    expect(otorgar.error?.code).toBe('42501')
    const revocar = await anon.rpc('revocar_consentimiento_imagen', { p_nino_id: nino.id })
    expect(revocar.error?.code).toBe('42501')
    expect(await flagDe(nino.id)).toBe(false)
  })

  it('un tutor que atribuye el consentimiento a OTRO usuario lo otorga a su propio nombre', async () => {
    const client = await clientFor(tutor)
    const { data, error } = await client.rpc('otorgar_consentimiento_imagen', {
      p_nino_id: nino.id,
      p_tutor: otro.id,
    })
    expect(error).toBeNull()
    expect(data).toBeTruthy()
    expect(await autorDe(data!)).toBe(tutor.id)
    expect(await flagDe(nino.id)).toBe(true)
  })

  it('el tutor de otro niño no puede otorgar ni revocar (42501)', async () => {
    const client = await clientFor(tutorAjeno)
    const otorgar = await client.rpc('otorgar_consentimiento_imagen', {
      p_nino_id: nino.id,
      p_tutor: tutorAjeno.id,
    })
    expect(otorgar.error?.code).toBe('42501')
    const revocar = await client.rpc('revocar_consentimiento_imagen', { p_nino_id: nino.id })
    expect(revocar.error?.code).toBe('42501')
    expect(await flagDe(nino.id)).toBe(true) // sigue el consentimiento del tutor
  })

  it('el tutor revoca el consentimiento de su hijo', async () => {
    const client = await clientFor(tutor)
    const { data, error } = await client.rpc('revocar_consentimiento_imagen', {
      p_nino_id: nino.id,
    })
    expect(error).toBeNull()
    expect(data).toBe(1)
    expect(await flagDe(nino.id)).toBe(false)
  })

  it('el admin sí puede otorgar en nombre de un tutor', async () => {
    const client = await clientFor(admin)
    const { data, error } = await client.rpc('otorgar_consentimiento_imagen', {
      p_nino_id: nino.id,
      p_tutor: otro.id,
    })
    expect(error).toBeNull()
    expect(await autorDe(data!)).toBe(otro.id)
    expect(await flagDe(nino.id)).toBe(true)
    // El otro niño no se ha tocado en ningún caso.
    expect(await flagDe(ninoAjeno.id)).toBe(false)
  })
})
