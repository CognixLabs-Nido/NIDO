import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/db'

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
 *  - titular (fila con su usuario_id) guarda su identidad, y da de alta al segundo_tutor sin cuenta,
 *    por `guardar_tutor` (desde la fase 6 el tutor no escribe la tabla: `20270118120000`).
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
  let ninoId: string
  let cTitular: SupabaseClient<Database>

  beforeAll(async () => {
    centro = await createTestCentro()
    titular = await createTestUser({ nombre: 'Titular F2b3' })
    ajeno = await createTestUser({ nombre: 'Tutor ajeno F2b3' })

    familiaId = await createTestFamilia(centro.id)
    familiaAjenaId = await createTestFamilia(centro.id)
    // Un niño de la familia: la ruta del DNI tiene que ser de un niño suyo (20261024130000).
    const { data: nino, error: ninoErr } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centro.id,
        familia_id: familiaId,
        nombre: 'Nino Wizard F2b3',
        primer_apellido: 'Apellido Test',
        fecha_nacimiento: '2024-03-15',
      })
      .select('id')
      .single()
    if (ninoErr || !nino) throw new Error(`nino de la familia falló: ${ninoErr?.message}`)
    ninoId = nino.id

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

  // Fase 6 (`20270118120000`): el tutor ya no escribe la tabla; el wizard pasa por `guardar_tutor`,
  // que aplica la regla única y la cola. Estos cuatro escribían la tabla directamente.
  const guardar = (rol: 'titular' | 'segundo_tutor', datos: Record<string, unknown>) =>
    cTitular.rpc('guardar_tutor', {
      p_familia_id: familiaId,
      p_rol_familia: rol,
      p_datos: datos as Database['public']['Functions']['guardar_tutor']['Args']['p_datos'],
    })

  it('titular: guarda la identidad de su fila por guardar_tutor; el UPDATE directo ya no escribe', async () => {
    const directo = await cTitular
      .from('familia_tutores')
      .update({ nombre_completo: 'Directo' })
      .eq('familia_id', familiaId)
      .eq('rol_familia', 'titular')
      .select('id')
    expect(directo.error).toBeNull()
    expect(directo.data).toEqual([])
    const { data, error } = await guardar('titular', { nombre_completo: 'Titular Editado' })
    expect(error).toBeNull()
    expect(data).not.toBeNull()
    const { data: fila } = await serviceClient
      .from('familia_tutores')
      .select('nombre_completo')
      .eq('familia_id', familiaId)
      .eq('rol_familia', 'titular')
      .single()
    expect(fila?.nombre_completo).toBe('Titular Editado')
  })

  it('titular: NO puede cambiar usuario_id: guardar_tutor no lo acepta y la tabla no la escribe', async () => {
    const { error } = await guardar('titular', { usuario_id: ajeno.id })
    expect(error?.code).toBe('22023')
    const directo = await cTitular
      .from('familia_tutores')
      .update({ usuario_id: ajeno.id })
      .eq('familia_id', familiaId)
      .eq('rol_familia', 'titular')
      .select('id')
    expect(directo.data ?? []).toEqual([])
  })

  it('titular: da de alta al segundo_tutor (sin cuenta) por guardar_tutor', async () => {
    const { data, error } = await guardar('segundo_tutor', { nombre_completo: 'Segundo Tutor' })
    expect(error).toBeNull()
    expect(data).not.toBeNull()
    const { data: fila } = await serviceClient
      .from('familia_tutores')
      .select('usuario_id, nombre_completo')
      .eq('id', data as string)
      .single()
    expect(fila).toEqual({ usuario_id: null, nombre_completo: 'Segundo Tutor' })
  })

  it('un segundo segundo_tutor no existe: guardar otra vez escribe la misma fila, y el índice lo para (23505)', async () => {
    const { error } = await guardar('segundo_tutor', { nombre_completo: 'Segundo Duplicado' })
    expect(error).toBeNull()
    const { data: filas } = await serviceClient
      .from('familia_tutores')
      .select('nombre_completo')
      .eq('familia_id', familiaId)
      .eq('rol_familia', 'segundo_tutor')
      .is('deleted_at', null)
    expect(filas).toEqual([{ nombre_completo: 'Segundo Duplicado' }])
    const cap = await serviceClient.from('familia_tutores').insert({
      familia_id: familiaId,
      rol_familia: 'segundo_tutor',
      usuario_id: null,
      nombre_completo: 'Tercero',
    })
    expect(cap.error?.code).toBe('23505')
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
      .update({ dni_documento_path: `${centro.id}/${ninoId}/dni.pdf` })
      .eq('familia_id', familiaId)
      .eq('rol_familia', 'titular')
    expect(error).toBeNull()
  })
})
