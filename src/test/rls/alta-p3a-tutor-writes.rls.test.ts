import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
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

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * F11 · Alta tutor-driven · Pieza 3a — backend de escritura del tutor.
 *
 * Migración 20260616170000_phase11_alta_p3a_tutor_writes. Verifica los gates de las
 * piezas más sensibles (RLS/RPC), sin UI:
 *   1. RPC médica del tutor: rechaza sin consentimiento; acepta con él; cifra y escribe
 *      cartilla; no puede tocar el niño de otra familia.
 *   2. RPC de identidad: el tutor escribe la whitelist; no toca centro; no el de otro.
 *   3. `datos_pedagogicos_nino`: el tutor escribe el suyo; RLS deniega el de otra familia.
 *   4. `tiene_consentimiento` refleja alta/revocación.
 *
 * Gateado: F11_ALTA_P3A_MIGRATION_APPLIED=1
 */

const APPLIED = process.env.F11_ALTA_P3A_MIGRATION_APPLIED === '1'

// El tipo generado declara los args de la RPC médica como no-nullable, pero acepta
// NULL (contrato "NULL = preservar"). Cast local para los tests (igual que las actions).
type MedicaArgs = {
  p_nino_id: string
  p_alergias_graves: string
  p_notas_emergencia: string
  p_medicacion_habitual: string
  p_alergias_leves: string
  p_medico_familia: string
  p_telefono_emergencia: string
  p_cartilla_vacunas_path: string
}
type IdentidadArgs = {
  p_nino_id: string
  p_apellidos: string
  p_fecha_nacimiento: string
  p_sexo: 'F' | 'M' | 'X'
  p_nacionalidad: string
  p_idioma_principal: string
}

function medicaArgs(ninoId: string, over: Partial<Record<keyof MedicaArgs, unknown>>): MedicaArgs {
  return {
    p_nino_id: ninoId,
    p_alergias_graves: null,
    p_notas_emergencia: null,
    p_medicacion_habitual: null,
    p_alergias_leves: null,
    p_medico_familia: null,
    p_telefono_emergencia: null,
    p_cartilla_vacunas_path: null,
    ...over,
  } as unknown as MedicaArgs
}

describe.skipIf(!APPLIED)('Alta P3a — escritura del tutor (RLS/RPC)', () => {
  let centro: { id: string }
  let ninoA: { id: string }
  let ninoB: { id: string }
  let tutorCon: TestUser // tutor LEGAL de ninoA, CON consentimiento datos_medicos
  let tutorSin: TestUser // tutor LEGAL de ninoB, SIN consentimiento
  let autorizadoA: TestUser // AUTORIZADO de ninoA, sin puede_ver_datos_pedagogicos
  let clientCon: SupabaseClient<Database>
  let clientSin: SupabaseClient<Database>
  let clientAut: SupabaseClient<Database>

  beforeAll(async () => {
    centro = await createTestCentro('Centro Alta P3a')
    ninoA = await createTestNino(centro.id, 'Nino A P3a')
    ninoB = await createTestNino(centro.id, 'Nino B P3a')
    tutorCon = await createTestUser({ nombre: 'Tutor Con' })
    tutorSin = await createTestUser({ nombre: 'Tutor Sin' })
    await crearVinculo(ninoA.id, tutorCon.id, 'tutor_legal_principal', {
      puede_ver_info_medica: true,
    })
    await crearVinculo(ninoB.id, tutorSin.id, 'tutor_legal_principal', {})
    autorizadoA = await createTestUser({ nombre: 'Autorizado A' })
    await crearVinculo(ninoA.id, autorizadoA.id, 'autorizado', {})
    clientCon = await clientFor(tutorCon)
    clientSin = await clientFor(tutorSin)
    clientAut = await clientFor(autorizadoA)

    // tutorCon otorga el consentimiento de datos médicos (auth.uid() = su id).
    await clientCon.rpc('registrar_consentimiento', {
      p_usuario_id: tutorCon.id,
      p_tipo: 'datos_medicos',
      p_version: 'v1.0',
    })
  })

  afterAll(async () => {
    await deleteTestCentro(centro.id)
    await deleteTestUser(tutorCon.id)
    await deleteTestUser(tutorSin.id)
    await deleteTestUser(autorizadoA.id)
  })

  it('tiene_consentimiento refleja alta y revocación', async () => {
    const { data: con } = await clientCon.rpc('tiene_consentimiento', {
      p_usuario_id: tutorCon.id,
      p_tipo: 'datos_medicos',
    })
    expect(con).toBe(true)

    const { data: sin } = await clientSin.rpc('tiene_consentimiento', {
      p_usuario_id: tutorSin.id,
      p_tipo: 'datos_medicos',
    })
    expect(sin).toBe(false)
  })

  it('RPC médica RECHAZA sin consentimiento vigente', async () => {
    const { error } = await clientSin.rpc(
      'set_info_medica_emergencia_cifrada_tutor',
      medicaArgs(ninoB.id, { p_alergias_graves: 'Polen' })
    )
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('RPC médica ACEPTA con consentimiento: cifra y escribe cartilla', async () => {
    const cartilla = `${centro.id}/${ninoA.id}/cartilla.jpg`
    const { data, error } = await clientCon.rpc(
      'set_info_medica_emergencia_cifrada_tutor',
      medicaArgs(ninoA.id, {
        p_alergias_graves: 'Frutos secos (grave)',
        p_cartilla_vacunas_path: cartilla,
      })
    )
    expect(error).toBeNull()
    expect(data).toBeTruthy()

    // Verifica vía service: alergias cifradas (bytea no nulo) + cartilla guardada.
    const { data: row } = await serviceClient
      .from('info_medica_emergencia')
      .select('alergias_graves, cartilla_vacunas_path')
      .eq('nino_id', ninoA.id)
      .single()
    expect(row?.cartilla_vacunas_path).toBe(cartilla)
    expect(row?.alergias_graves).not.toBeNull()
  })

  it('RPC médica: un tutor NO puede escribir la médica de otro niño', async () => {
    const { error } = await clientCon.rpc(
      'set_info_medica_emergencia_cifrada_tutor',
      medicaArgs(ninoB.id, { p_alergias_graves: 'X' })
    )
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('RPC identidad: el tutor escribe la whitelist; no toca centro; no el de otro', async () => {
    const { error } = await clientCon.rpc('actualizar_identidad_nino_tutor', {
      p_nino_id: ninoA.id,
      p_apellidos: 'Apellido Tutor',
      p_fecha_nacimiento: '2024-03-01',
      p_sexo: 'F',
      p_nacionalidad: 'ES',
      p_idioma_principal: 'va',
    } as unknown as IdentidadArgs)
    expect(error).toBeNull()

    const { data: nino } = await serviceClient
      .from('ninos')
      .select('apellidos, fecha_nacimiento, idioma_principal, centro_id')
      .eq('id', ninoA.id)
      .single()
    expect(nino?.apellidos).toBe('Apellido Tutor')
    expect(nino?.fecha_nacimiento).toBe('2024-03-01')
    expect(nino?.idioma_principal).toBe('va')
    expect(nino?.centro_id).toBe(centro.id) // intacto (la RPC no lo acepta)

    // Otro niño → denegado.
    const { error: ajeno } = await clientCon.rpc('actualizar_identidad_nino_tutor', {
      p_nino_id: ninoB.id,
      p_apellidos: 'Hack',
      p_fecha_nacimiento: '2024-01-01',
      p_sexo: 'M',
      p_nacionalidad: 'ES',
      p_idioma_principal: 'es',
    } as unknown as IdentidadArgs)
    expect(ajeno).not.toBeNull()
    expect(ajeno?.code).toBe('42501')
  })

  it('datos_pedagogicos: el tutor escribe el suyo; RLS deniega el de otra familia', async () => {
    const propio = await clientCon
      .from('datos_pedagogicos_nino')
      .insert({
        nino_id: ninoA.id,
        lactancia_estado: 'no_aplica',
        control_esfinteres: 'panal_completo',
        tipo_alimentacion: 'omnivora',
        idiomas_casa: ['es'],
        tiene_hermanos_en_centro: false,
      })
      .select('id')
      .maybeSingle()
    expect(propio.error).toBeNull()
    expect(propio.data).not.toBeNull()

    const ajeno = await clientCon
      .from('datos_pedagogicos_nino')
      .insert({
        nino_id: ninoB.id,
        lactancia_estado: 'no_aplica',
        control_esfinteres: 'panal_completo',
        tipo_alimentacion: 'omnivora',
        idiomas_casa: ['es'],
        tiene_hermanos_en_centro: false,
      })
      .select('id')
      .maybeSingle()
    expect(ajeno.error).not.toBeNull() // RLS WITH CHECK es_tutor_de(ninoB) = false
  })

  it("'autorizado' sin permiso NO lee los pedagógicos (D7: solo el tutor legal por defecto)", async () => {
    // tutorCon (legal) escribió los pedagógicos de ninoA en el test anterior.
    const { data, error } = await clientAut
      .from('datos_pedagogicos_nino')
      .select('id')
      .eq('nino_id', ninoA.id)
    // SELECT bajo RLS: filas denegadas se filtran (sin error) → resultado vacío.
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })
})
