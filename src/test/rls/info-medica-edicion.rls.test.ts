import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createTestCentro,
  createTestNino,
  createTestUser,
  crearVinculo,
  clientFor,
  deleteTestCentro,
  deleteTestUser,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * F11-F3 — edición a nivel de campo de la info médica (post-alta).
 *
 * Migración 20260621120000_phase11_f3_info_medica_edicion_replace: la RPC
 * `set_info_medica_emergencia_cifrada_tutor` gana `p_reemplazar boolean DEFAULT false`.
 *
 * Verifica las DOS semánticas desacopladas:
 *  - MERGE (default, SIN el flag) — el wizard de alta: NULL en un campo PRESERVA el
 *    valor existente (contrato F11-F intacto). REGRESIÓN del wizard.
 *  - REPLACE (`p_reemplazar=true`) — la edición de la ficha: cada campo es verbatim;
 *    NULL LIMPIA. "Lo que se ve es lo que se guarda", incluido vaciar un campo suelto.
 *
 * Gateado: F11_F3_MIGRATION_APPLIED=1
 */

const APPLIED = process.env.F11_F3_MIGRATION_APPLIED === '1'

// El tipo generado declara los args text como no-nullable y p_reemplazar opcional;
// la RPC acepta NULL en los text (contrato preservar/limpiar). Cast local.
type MedicaArgs = {
  p_nino_id: string
  p_alergias_graves: string | null
  p_notas_emergencia: string | null
  p_medicacion_habitual: string | null
  p_alergias_leves: string | null
  p_medico_familia: string | null
  p_telefono_emergencia: string | null
  p_reemplazar?: boolean
}

function medicaArgs(ninoId: string, over: Partial<MedicaArgs>): MedicaArgs {
  return {
    p_nino_id: ninoId,
    p_alergias_graves: null,
    p_notas_emergencia: null,
    p_medicacion_habitual: null,
    p_alergias_leves: null,
    p_medico_familia: null,
    p_telefono_emergencia: null,
    ...over,
  }
}

describe.skipIf(!APPLIED)('F11-F3 — edición info médica: merge vs replace (RLS/RPC)', () => {
  let centro: { id: string }
  let nino: { id: string }
  let tutorLegal: TestUser
  let clientLegal: SupabaseClient<Database>

  beforeAll(async () => {
    centro = await createTestCentro('Centro F11F3 edicion medica')
    nino = await createTestNino(centro.id, 'Nino F11F3')
    tutorLegal = await createTestUser({ nombre: 'Tutor Legal F3' })
    await crearVinculo(nino.id, tutorLegal.id, 'tutor_legal_principal', {
      puede_ver_info_medica: true,
    })
    clientLegal = await clientFor(tutorLegal)
  })

  afterAll(async () => {
    await deleteTestCentro(centro.id)
    await deleteTestUser(tutorLegal.id)
  })

  // Lee la médica descifrada como el tutor legal (gate `puede_ver_info_medica`).
  async function leer() {
    const { data, error } = await clientLegal.rpc('get_info_medica_emergencia', {
      p_nino_id: nino.id,
    })
    expect(error).toBeNull()
    return data && data.length > 0 ? data[0] : null
  }

  async function escribir(over: Partial<MedicaArgs>) {
    const { error } = await clientLegal.rpc(
      'set_info_medica_emergencia_cifrada_tutor',
      medicaArgs(nino.id, over) as never
    )
    expect(error).toBeNull()
  }

  it('MERGE (default, wizard): NULL preserva el valor existente — regresión wizard', async () => {
    // Siembra dos campos.
    await escribir({ p_alergias_graves: 'Polen', p_telefono_emergencia: '600000000' })
    // Segunda llamada MERGE: cambia uno, los demás NULL (omitidos por el wizard).
    await escribir({ p_alergias_graves: 'Cacahuete' })
    const row = await leer()
    expect(row?.alergias_graves).toBe('Cacahuete') // actualizado
    expect(row?.telefono_emergencia).toBe('600000000') // PRESERVADO pese al NULL
  })

  it('REPLACE: un campo a NULL LIMPIA el valor existente (vaciar campo suelto)', async () => {
    // Estado previo: alergias_graves='Cacahuete', telefono='600000000'.
    // REPLACE escribiendo solo alergias_graves; el resto NULL → se limpia.
    await escribir({ p_alergias_graves: 'Cacahuete', p_reemplazar: true })
    const row = await leer()
    expect(row?.alergias_graves).toBe('Cacahuete') // se mantiene (se reenvió)
    expect(row?.telefono_emergencia ?? null).toBeNull() // LIMPIADO por replace
  })

  it('REPLACE: "lo que se ve es lo que se guarda" — setea y limpia a la vez', async () => {
    // Pone medico_familia, deja todo lo demás a NULL → la ficha queda con SOLO ese campo.
    await escribir({ p_medico_familia: 'Dra. García', p_reemplazar: true })
    const row = await leer()
    expect(row?.medico_familia).toBe('Dra. García')
    expect(row?.alergias_graves ?? null).toBeNull()
    expect(row?.notas_emergencia ?? null).toBeNull()
    expect(row?.medicacion_habitual ?? null).toBeNull()
    expect(row?.alergias_leves ?? null).toBeNull()
    expect(row?.telefono_emergencia ?? null).toBeNull()
  })
})
