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
 * F11 · Flag-2 (F11-F2) — borrado de info médica voluntaria por el tutor legal.
 *
 * Migración 20260620140000_phase11_f2_borrar_info_medica_voluntaria
 * (RPC `borrar_info_medica_nino_tutor`). Cierra el modelo de F11-F: la médica es
 * voluntaria y la RPC de escritura usa "NULL = preservar", así que no puede vaciarla;
 * este borrado retira el dato compartido. Gate SOLO es_tutor_legal_de (simetría con
 * la escritura): cualquier tutor legal borra; 'autorizado' y admin-no-tutor denegados.
 *
 * Gateado: F11_ALTA_P3F2_MIGRATION_APPLIED=1
 */

const APPLIED = process.env.F11_ALTA_P3F2_MIGRATION_APPLIED === '1'

// El tipo generado declara los args de la RPC médica como no-nullable, pero acepta
// NULL (contrato "NULL = preservar"). Cast local (igual que las actions/otros tests).
type MedicaArgs = {
  p_nino_id: string
  p_alergias_graves: string
  p_notas_emergencia: string
  p_medicacion_habitual: string
  p_alergias_leves: string
  p_medico_familia: string
  p_telefono_emergencia: string
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
    ...over,
  } as unknown as MedicaArgs
}

async function existeMedica(ninoId: string): Promise<boolean> {
  const { data } = await serviceClient
    .from('info_medica_emergencia')
    .select('nino_id')
    .eq('nino_id', ninoId)
    .maybeSingle()
  return data !== null
}

describe.skipIf(!APPLIED)('Flag-2 — borrar info médica voluntaria (RLS/RPC)', () => {
  let centro: { id: string }
  let nino: { id: string }
  let tutorLegal: TestUser // tutor_legal_principal de nino
  let tutorLegal2: TestUser // tutor_legal_secundario de nino (simetría doble custodia)
  let autorizado: TestUser // autorizado de nino (NO legal)
  let admin: TestUser // dirección del centro, sin vínculo con el niño
  let clientLegal: SupabaseClient<Database>
  let clientLegal2: SupabaseClient<Database>
  let clientAut: SupabaseClient<Database>
  let clientAdmin: SupabaseClient<Database>

  beforeAll(async () => {
    centro = await createTestCentro('Centro Flag2 borrar medica')
    nino = await createTestNino(centro.id, 'Nino Flag2')
    tutorLegal = await createTestUser({ nombre: 'Tutor Legal F2' })
    tutorLegal2 = await createTestUser({ nombre: 'Tutor Legal2 F2' })
    autorizado = await createTestUser({ nombre: 'Autorizado F2' })
    admin = await createTestUser({ nombre: 'Admin F2' })
    await crearVinculo(nino.id, tutorLegal.id, 'tutor_legal_principal', {
      puede_ver_info_medica: true,
    })
    await crearVinculo(nino.id, tutorLegal2.id, 'tutor_legal_secundario', {
      puede_ver_info_medica: true,
    })
    await crearVinculo(nino.id, autorizado.id, 'autorizado', {})
    await asignarRol(admin.id, centro.id, 'admin')
    clientLegal = await clientFor(tutorLegal)
    clientLegal2 = await clientFor(tutorLegal2)
    clientAut = await clientFor(autorizado)
    clientAdmin = await clientFor(admin)
  })

  afterAll(async () => {
    await deleteTestCentro(centro.id)
    await deleteTestUser(tutorLegal.id)
    await deleteTestUser(tutorLegal2.id)
    await deleteTestUser(autorizado.id)
    await deleteTestUser(admin.id)
  })

  async function sembrarMedica() {
    const { error } = await clientLegal.rpc(
      'set_info_medica_emergencia_cifrada_tutor',
      medicaArgs(nino.id, { p_alergias_graves: 'Polen', p_telefono_emergencia: '600000000' })
    )
    expect(error).toBeNull()
    expect(await existeMedica(nino.id)).toBe(true)
  }

  it("un 'autorizado' NO puede borrar la médica (42501)", async () => {
    await sembrarMedica()
    const { error } = await clientAut.rpc('borrar_info_medica_nino_tutor', { p_nino_id: nino.id })
    expect(error?.code).toBe('42501')
    expect(await existeMedica(nino.id)).toBe(true) // intacta
  })

  it('la dirección (admin) NO-tutor NO puede borrar la médica (42501)', async () => {
    const { error } = await clientAdmin.rpc('borrar_info_medica_nino_tutor', { p_nino_id: nino.id })
    expect(error?.code).toBe('42501')
    expect(await existeMedica(nino.id)).toBe(true) // intacta
  })

  it('el tutor legal borra la médica → la fila desaparece (médica vacía)', async () => {
    const { error } = await clientLegal.rpc('borrar_info_medica_nino_tutor', { p_nino_id: nino.id })
    expect(error).toBeNull()
    expect(await existeMedica(nino.id)).toBe(false)
  })

  it('borrar de nuevo es idempotente (0 filas, sin error)', async () => {
    const { error } = await clientLegal.rpc('borrar_info_medica_nino_tutor', { p_nino_id: nino.id })
    expect(error).toBeNull()
    expect(await existeMedica(nino.id)).toBe(false)
  })

  it('doble custodia: el tutor legal secundario también puede borrar (simetría con la escritura)', async () => {
    await sembrarMedica()
    const { error } = await clientLegal2.rpc('borrar_info_medica_nino_tutor', {
      p_nino_id: nino.id,
    })
    expect(error).toBeNull()
    expect(await existeMedica(nino.id)).toBe(false)
  })
})
