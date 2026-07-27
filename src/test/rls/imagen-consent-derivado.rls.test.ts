import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createTestCentro,
  createTestNino,
  createTestUser,
  deleteTestUser,
  serviceClient,
} from './setup'

/**
 * IU-0 — Autorización de IMAGEN por-niño: `consentimientos` (tipo='imagen') como fuente de
 * verdad y `ninos.puede_aparecer_en_fotos` DERIVADO por trigger.
 *
 * Migración: 20260821120000_phase_imagen_iu0_consent_por_nino (nino_id + CHECK +
 * helpers otorgar/revocar/tiene_consentimiento_imagen + trigger consentimiento_imagen_sync).
 *
 * Verifica el RIGOR del derivado (dato sensible de menores): por-niño estricto (un hermano
 * no afecta al otro), otorgar→true / revocar→false / re-otorgar→true, sin consent→false
 * (no NULL), y el CHECK imagen⇒nino_id NOT NULL.
 *
 * Gateado (la migración la aplica Jose a mano): IMAGEN_CONSENT_DERIVADO_APPLIED=1
 */

const MIGRATION_APPLIED = process.env.IMAGEN_CONSENT_DERIVADO_APPLIED === '1'

describe.skipIf(!MIGRATION_APPLIED)('IU-0 imagen consent por-niño + flag derivado', () => {
  let centro: { id: string }
  let ninoA: { id: string; familia_id: string }
  let ninoB: { id: string } // HERMANO de A (misma familia)
  let tutor: { id: string }

  const flagDe = async (ninoId: string): Promise<boolean | null> => {
    const { data } = await serviceClient
      .from('ninos')
      .select('puede_aparecer_en_fotos')
      .eq('id', ninoId)
      .single()
    return data?.puede_aparecer_en_fotos ?? null
  }
  const otorgar = (ninoId: string) =>
    serviceClient.rpc('otorgar_consentimiento_imagen', { p_nino_id: ninoId, p_tutor: tutor.id })
  const revocar = (ninoId: string) =>
    serviceClient.rpc('revocar_consentimiento_imagen', { p_nino_id: ninoId })

  beforeAll(async () => {
    centro = await createTestCentro('IU0-imagen')
    tutor = await createTestUser({ nombre: 'Tutor IU0' })
    ninoA = await createTestNino(centro.id, 'Nino A IU0')
    // B = hermano de A (misma familia) para probar el aislamiento por-niño.
    const { data, error } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centro.id,
        familia_id: ninoA.familia_id,
        nombre: 'Hermano B IU0',
        apellidos: 'Apellido Test',
        fecha_nacimiento: '2025-05-10',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`crear hermano B falló: ${error?.message}`)
    ninoB = { id: data.id }
  })

  afterAll(async () => {
    await serviceClient.from('consentimientos').delete().in('nino_id', [ninoA.id, ninoB.id])
    await serviceClient.from('ninos').delete().in('id', [ninoA.id, ninoB.id])
    await deleteTestUser(tutor.id)
  })

  it('arranca en false (derivado, sin consentimiento) para ambos', async () => {
    expect(await flagDe(ninoA.id)).toBe(false)
    expect(await flagDe(ninoB.id)).toBe(false)
  })

  it('otorgar a A pone SU flag en true y NO toca al hermano B', async () => {
    const { error } = await otorgar(ninoA.id)
    expect(error).toBeNull()
    expect(await flagDe(ninoA.id)).toBe(true)
    expect(await flagDe(ninoB.id)).toBe(false) // hermano intacto
  })

  it('revocar a A baja SU flag a false; B sigue intacto', async () => {
    const { error } = await revocar(ninoA.id)
    expect(error).toBeNull()
    expect(await flagDe(ninoA.id)).toBe(false)
    expect(await flagDe(ninoB.id)).toBe(false)
  })

  it('re-otorgar a A lo vuelve a poner en true', async () => {
    await otorgar(ninoA.id)
    expect(await flagDe(ninoA.id)).toBe(true)
    expect(await flagDe(ninoB.id)).toBe(false)
  })

  it('un niño sin ninguna fila de consentimiento imagen → flag false (no NULL, no true)', async () => {
    expect(await flagDe(ninoB.id)).toBe(false)
    expect(
      await serviceClient.rpc('tiene_consentimiento_imagen', { p_nino_id: ninoB.id })
    ).toMatchObject({ data: false })
  })

  it('el CHECK rechaza un consentimiento imagen con nino_id NULL', async () => {
    const { error } = await serviceClient
      .from('consentimientos')
      .insert({ usuario_id: tutor.id, tipo: 'imagen', version: 'x', nino_id: null })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('23514') // check_violation
  })
})
