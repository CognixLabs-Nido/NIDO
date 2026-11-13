import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/db'

import { comoPostgres } from './documentos-centro-fixture'
import {
  asignarProfeAula,
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearFamiliaTutor,
  crearVinculo,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * `familia_tutores` por columnas (`20270117120000`, fase 6, paso 1; 2026-11-13). Antes de añadir datos
 * personales del tutor, la sesión deja de tener el SELECT de tabla y lee las 15 columnas que había:
 * quién ve la fila no cambia, y **una columna nueva nace cerrada**. Medido ABIERTO en producción
 * (ensayo terminado en RAISE): con una columna nueva simulada, la leían la Dirección y los dos
 * tutores, cada uno la del otro.
 */
const COLUMNAS_APP =
  'id, rol_familia, usuario_id, email, nombre_completo, direccion_calle, direccion_numero, direccion_cp, direccion_ciudad, dni_documento_path'

describe('familia_tutores por columnas', () => {
  let nino: { id: string; familia_id: string }
  let titular: TestUser
  let segundo: TestUser
  let admin: TestUser
  let autorizado: TestUser
  let profe: TestUser
  const sesion: Record<string, SupabaseClient<Database>> = {}

  beforeAll(async () => {
    const centro = await createTestCentro('Centro Tutores Por Columnas')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id, 'Nino Tutores Por Columnas')
    await matricular(nino.id, aula.id, curso.id)
    titular = await createTestUser({ nombre: 'Titular Por Columnas' })
    segundo = await createTestUser({ nombre: 'Segundo Por Columnas' })
    admin = await createTestUser({ nombre: 'Admin Por Columnas' })
    autorizado = await createTestUser({ nombre: 'Autorizado Por Columnas' })
    profe = await createTestUser({ nombre: 'Profe Por Columnas' })
    await crearFamiliaTutor(nino.familia_id, titular.id, 'titular')
    await crearFamiliaTutor(nino.familia_id, segundo.id, 'segundo_tutor')
    await crearVinculo(nino.id, titular.id, 'tutor_legal_principal')
    await crearVinculo(nino.id, segundo.id, 'tutor_legal_secundario')
    await crearVinculo(nino.id, autorizado.id, 'autorizado')
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarProfeAula(profe.id, aula.id, curso.id)
    for (const [k, u] of Object.entries({ titular, segundo, admin, autorizado, profe }))
      sesion[k] = await clientFor(u)
  })

  afterAll(async () => {
    for (const u of [titular, segundo, admin, autorizado, profe]) if (u) await deleteTestUser(u.id)
  })

  it('premisa y forma: sin SELECT de tabla para la sesión; las 15 de antes abiertas y las 5 de la fase 6, no', () => {
    expect(
      comoPostgres(
        "SELECT has_table_privilege('authenticated', 'public.familia_tutores', 'SELECT');"
      )
    ).toBe('f')
    expect(
      comoPostgres(`SELECT count(*) FILTER (WHERE has_column_privilege('authenticated',
        'public.familia_tutores', attname, 'SELECT')) || '/' || count(*)
        FROM pg_attribute WHERE attrelid = 'public.familia_tutores'::regclass AND attnum > 0
        AND NOT attisdropped;`)
    ).toBe('15/20')
    // Las cinco de `20270118120000` nacieron cerradas: se leen por `tutores_de_familia`.
    expect(
      comoPostgres(`SELECT string_agg(c, ',' ORDER BY c) FROM unnest(ARRAY['telefono',
        'fecha_nacimiento', 'dni_numero', 'estudios', 'empresa']) c
        WHERE NOT has_column_privilege('authenticated', 'public.familia_tutores', c, 'SELECT');`)
    ).toBe('dni_numero,empresa,estudios,fecha_nacimiento,telefono')
  })

  it('una columna nueva nace cerrada a la sesión (y el servidor la lee)', () => {
    const r = comoPostgres(`BEGIN;
      ALTER TABLE public.familia_tutores ADD COLUMN x_prueba_cerrada text;
      SELECT has_column_privilege('authenticated', 'public.familia_tutores', 'x_prueba_cerrada', 'SELECT')
        || ',' || has_column_privilege('service_role', 'public.familia_tutores', 'x_prueba_cerrada', 'SELECT');
      ROLLBACK;`)
    expect(r).toBe('false,true')
  })

  async function lee(quien: string) {
    const { data, error } = await sesion[quien]!.from('familia_tutores')
      .select(COLUMNAS_APP)
      .eq('familia_id', nino.familia_id)
      .is('deleted_at', null)
    if (error) throw new Error(`${quien}: ${error.message}`)
    return data.length
  }

  it('quién lee la fila no cambia: la Dirección y los dos tutores, con las columnas de la app', async () => {
    expect(await lee('admin')).toBe(2)
    expect(await lee('titular')).toBe(2)
    expect(await lee('segundo')).toBe(2)
  })

  it('el autorizado y la profe del aula siguen sin leerla', async () => {
    // Premisas: el autorizado tiene vínculo con el niño y la profe es del aula del niño.
    const { data: tutorDe } = await sesion.autorizado!.rpc('es_tutor_de', { p_nino_id: nino.id })
    expect(tutorDe).toBe(true)
    const { data: profeDe } = await sesion.profe!.rpc('es_profe_de_nino', { p_nino_id: nino.id })
    expect(profeDe).toBe(true)
    expect(await lee('autorizado')).toBe(0)
    expect(await lee('profe')).toBe(0)
  })

  it('el titular sigue guardando su fila, ahora por guardar_tutor (desde 20270118120000)', async () => {
    // Con el alta en curso: con el alta validada, el cambio iría a la cola (lo mide la puerta).
    const pend = await serviceClient
      .from('matriculas')
      .update({ estado: 'pendiente' })
      .eq('nino_id', nino.id)
    expect(pend.error).toBeNull()
    try {
      const { data, error } = await sesion.titular!.rpc('guardar_tutor', {
        p_familia_id: nino.familia_id,
        p_rol_familia: 'titular',
        p_datos: { direccion_numero: '3' },
      })
      expect(error).toBeNull()
      expect(data).not.toBeNull()
    } finally {
      await serviceClient.from('matriculas').update({ estado: 'activa' }).eq('nino_id', nino.id)
    }
  })
})
