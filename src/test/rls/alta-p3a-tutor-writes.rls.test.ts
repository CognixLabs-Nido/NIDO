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
 *   5. F11-E: los 6 writes apretados a es_tutor_legal_de deniegan al 'autorizado';
 *      la dirección (admin) sigue cambiando la foto vía actualizar_foto_nino_tutor.
 *
 * Gateado: F11_ALTA_P3A_MIGRATION_APPLIED=1
 */

const APPLIED = process.env.F11_ALTA_P3A_MIGRATION_APPLIED === '1'

// Cabecera mínima de un JPEG válido para los intentos de subida a Storage (F11-E).
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

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
  let admin: TestUser // dirección del centro (F11-E: regresión foto)
  let ninoE: { id: string } // niño SIN fila pedagógica (F11-E: dp_tutor_insert denegado)
  let clientCon: SupabaseClient<Database>
  let clientSin: SupabaseClient<Database>
  let clientAut: SupabaseClient<Database>
  let clientAdmin: SupabaseClient<Database>

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
    // F11-E: niño sin fila pedagógica con el MISMO autorizado vinculado, para probar
    // que dp_tutor_insert deniega al autorizado (no a un extraño).
    ninoE = await createTestNino(centro.id, 'Nino E P3a')
    await crearVinculo(ninoE.id, autorizadoA.id, 'autorizado', {})
    // F11-E: dirección del centro, para la regresión "admin SÍ cambia la foto".
    admin = await createTestUser({ nombre: 'Admin Dir P3a' })
    await asignarRol(admin.id, centro.id, 'admin')
    clientCon = await clientFor(tutorCon)
    clientSin = await clientFor(tutorSin)
    clientAut = await clientFor(autorizadoA)
    clientAdmin = await clientFor(admin)

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
    await deleteTestUser(admin.id)
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

  // ---------------------------------------------------------------------------
  // F11-E — los 6 writes del alta se apretaron de es_tutor_de a es_tutor_legal_de.
  // Un 'autorizado' (vinculado a ninoA/ninoE, pero NO tutor legal) queda denegado en
  // todos; la dirección (admin) sigue pudiendo cambiar la foto (regresión).
  // ---------------------------------------------------------------------------
  describe('F11-E — apretado a tutor legal (autorizado denegado)', () => {
    it('RPC médica: un autorizado NO puede escribir la médica (42501)', async () => {
      const { error } = await clientAut.rpc(
        'set_info_medica_emergencia_cifrada_tutor',
        medicaArgs(ninoA.id, { p_alergias_graves: 'X' })
      )
      expect(error?.code).toBe('42501')
    })

    it('RPC identidad: un autorizado NO puede escribir la identidad (42501)', async () => {
      const { error } = await clientAut.rpc('actualizar_identidad_nino_tutor', {
        p_nino_id: ninoA.id,
        p_apellidos: 'Hack',
        p_fecha_nacimiento: '2024-01-01',
        p_sexo: 'M',
        p_nacionalidad: 'ES',
        p_idioma_principal: 'es',
      } as unknown as IdentidadArgs)
      expect(error?.code).toBe('42501')
    })

    it('dp_tutor_insert: un autorizado NO puede insertar pedagógicos (WITH CHECK deniega)', async () => {
      const { error } = await clientAut
        .from('datos_pedagogicos_nino')
        .insert({
          nino_id: ninoE.id,
          lactancia_estado: 'no_aplica',
          control_esfinteres: 'panal_completo',
          tipo_alimentacion: 'omnivora',
          idiomas_casa: ['es'],
          tiene_hermanos_en_centro: false,
        })
        .select('id')
        .maybeSingle()
      expect(error).not.toBeNull() // RLS WITH CHECK es_tutor_legal_de(ninoE) = false
    })

    it('dp_tutor_update: un autorizado NO puede actualizar pedagógicos (USING → 0 filas)', async () => {
      // ninoA tiene fila pedagógica (la escribió tutorCon). USING es_tutor_legal_de
      // filtra → 0 filas, sin error (gotcha "USING falso → 0 filas").
      const { data, error } = await clientAut
        .from('datos_pedagogicos_nino')
        .update({ tiene_hermanos_en_centro: true })
        .eq('nino_id', ninoA.id)
        .select('id')
        .maybeSingle()
      expect(error).toBeNull()
      expect(data).toBeNull()
    })

    it('storage cartilla-vacunas: un autorizado NO puede subir (RLS deniega)', async () => {
      const res = await clientAut.storage
        .from('cartilla-vacunas')
        .upload(`${centro.id}/${ninoA.id}/cartilla.jpg`, JPG, {
          contentType: 'image/jpeg',
          upsert: true,
        })
      expect(res.error).toBeTruthy()
    })

    it('storage ninos-fotos: un autorizado NO puede subir la foto (RLS deniega)', async () => {
      const res = await clientAut.storage
        .from('ninos-fotos')
        .upload(`${centro.id}/${ninoA.id}/foto.jpg`, JPG, {
          contentType: 'image/jpeg',
          upsert: true,
        })
      expect(res.error).toBeTruthy()
    })

    it('RPC foto: un autorizado NO puede cambiar la foto (42501)', async () => {
      const { error } = await clientAut.rpc('actualizar_foto_nino_tutor', {
        p_nino_id: ninoA.id,
        p_foto_path: `${centro.id}/${ninoA.id}/foto.jpg`,
      })
      expect(error?.code).toBe('42501')
    })

    it('RPC foto: la dirección (admin) SÍ cambia la foto (regresión: no rompemos a dirección)', async () => {
      const path = `${centro.id}/${ninoA.id}/admin-foto.jpg`
      const { error } = await clientAdmin.rpc('actualizar_foto_nino_tutor', {
        p_nino_id: ninoA.id,
        p_foto_path: path,
      })
      expect(error).toBeNull()

      const { data: nino } = await serviceClient
        .from('ninos')
        .select('foto_url')
        .eq('id', ninoA.id)
        .single()
      expect(nino?.foto_url).toBe(path)
    })
  })
})
