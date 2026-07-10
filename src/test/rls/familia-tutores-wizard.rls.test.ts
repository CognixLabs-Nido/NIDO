import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

import {
  clientFor,
  createTestCentro,
  createTestFamilia,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestCentro,
  type TestUser,
} from './setup'

/**
 * F-2b-3 — invariantes RLS de las escrituras del wizard sobre `familia_tutores` (perfil
 * COMPARTIDO por familia). Verifica lo que el wizard/cola necesitan y lo que NO deben poder:
 *  - titular (fila con su usuario_id) UPDATE de identidad de su fila.
 *  - titular INSERT del segundo_tutor (usuario_id NULL, rol='segundo_tutor').
 *  - cap declarativo: 2.º segundo_tutor → 23505.
 *  - anti-secuestro: NO insertar titular, NO insertar con usuario_id, NO cross-familia.
 *  - congelado (BEFORE UPDATE): tutor NO cambia usuario_id/familia_id/rol_familia.
 *  - service_role (cola) aplica UPDATE/INSERT sin bloqueo.
 */
describe('familia_tutores — escrituras del wizard (F-2b-3)', () => {
  let centro: TestCentro
  let titular: TestUser
  let ajeno: TestUser
  let familiaId: string
  let familiaAjenaId: string
  let cTitular: SupabaseClient<Database>

  beforeAll(async () => {
    centro = await createTestCentro()
    titular = await createTestUser({ nombre: 'Titular F2b3' })
    ajeno = await createTestUser({ nombre: 'Tutor ajeno F2b3' })

    familiaId = await createTestFamilia(centro.id)
    familiaAjenaId = await createTestFamilia(centro.id)

    // Fila titular con la cuenta del titular (así es_tutor_de_familia = TRUE para él).
    await serviceClient.from('familia_tutores').insert({
      familia_id: familiaId,
      usuario_id: titular.id,
      rol_familia: 'titular',
      email: 'titular@nido.test',
      nombre_completo: 'Titular Inicial',
    })
    // Familia ajena: su titular es otro usuario.
    await serviceClient.from('familia_tutores').insert({
      familia_id: familiaAjenaId,
      usuario_id: ajeno.id,
      rol_familia: 'titular',
      email: 'ajeno@nido.test',
      nombre_completo: 'Ajeno Inicial',
    })

    cTitular = await clientFor(titular)
  })

  afterAll(async () => {
    if (centro) await deleteTestCentro(centro.id)
    for (const u of [titular, ajeno]) if (u) await deleteTestUser(u.id)
  })

  it('titular: UPDATE de identidad de su fila', async () => {
    const { data, error } = await cTitular
      .from('familia_tutores')
      .update({ nombre_completo: 'Titular Editado' })
      .eq('familia_id', familiaId)
      .eq('rol_familia', 'titular')
      .select('id')
      .maybeSingle()
    expect(error).toBeNull()
    expect(data).not.toBeNull()
  })

  it('titular: NO puede cambiar usuario_id (congelado BEFORE UPDATE)', async () => {
    const { error } = await cTitular
      .from('familia_tutores')
      .update({ usuario_id: ajeno.id })
      .eq('familia_id', familiaId)
      .eq('rol_familia', 'titular')
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('titular: INSERT del segundo_tutor (usuario_id NULL)', async () => {
    const { data, error } = await cTitular
      .from('familia_tutores')
      .insert({
        familia_id: familiaId,
        rol_familia: 'segundo_tutor',
        usuario_id: null,
        nombre_completo: 'Segundo Tutor',
      })
      .select('id')
      .maybeSingle()
    expect(error).toBeNull()
    expect(data).not.toBeNull()
  })

  it('titular: 2.º segundo_tutor activo → 23505 (cap declarativo)', async () => {
    const { error } = await cTitular.from('familia_tutores').insert({
      familia_id: familiaId,
      rol_familia: 'segundo_tutor',
      usuario_id: null,
      nombre_completo: 'Segundo Duplicado',
    })
    expect(error?.code).toBe('23505')
  })

  it('titular: NO puede insertar otra fila titular', async () => {
    const { error } = await cTitular.from('familia_tutores').insert({
      familia_id: familiaId,
      rol_familia: 'titular',
      usuario_id: null,
      nombre_completo: 'Titular Fantasma',
    })
    expect(error?.code).toBe('42501')
  })

  it('titular: NO puede insertar segundo_tutor con usuario_id (anti-secuestro)', async () => {
    const { error } = await cTitular.from('familia_tutores').insert({
      familia_id: familiaId,
      rol_familia: 'segundo_tutor',
      usuario_id: ajeno.id,
      nombre_completo: 'Secuestro',
    })
    expect(error?.code).toBe('42501')
  })

  it('cross-familia: el titular NO ve ni escribe la familia ajena', async () => {
    const { data: verAjena } = await cTitular
      .from('familia_tutores')
      .select('id')
      .eq('familia_id', familiaAjenaId)
    expect(verAjena ?? []).toHaveLength(0)

    const { error } = await cTitular.from('familia_tutores').insert({
      familia_id: familiaAjenaId,
      rol_familia: 'segundo_tutor',
      usuario_id: null,
      nombre_completo: 'Intruso',
    })
    expect(error?.code).toBe('42501')
  })

  it('service_role: aplica UPDATE de identidad sin bloqueo (cola de validación)', async () => {
    const { error } = await serviceClient
      .from('familia_tutores')
      .update({ dni_documento_path: `${centro.id}/dni.pdf` })
      .eq('familia_id', familiaId)
      .eq('rol_familia', 'titular')
    expect(error).toBeNull()
  })
})
