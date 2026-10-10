import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { anonClient, clientFor, createTestUser, deleteTestUser, type TestUser } from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Privilegios de TABLA de anon: ninguno en `public`.
 *
 * Migración: 20261010140000_fix_privilegios_tabla_anon
 *   - REVOKE ALL de anon (y PUBLIC) en las 73 tablas de public: ni SELECT, ni INSERT, UPDATE,
 *     DELETE, TRUNCATE, REFERENCES, TRIGGER ni MAINTAIN.
 *   - REVOKE TRUNCATE y MAINTAIN de authenticated (no pasan por RLS); su SELECT/INSERT/UPDATE/
 *     DELETE, acotado por la RLS, no cambia.
 *   - Default privileges de postgres en public: las tablas, funciones y secuencias nuevas ya no
 *     nacen abiertas a anon, ni las tablas con TRUNCATE/MAINTAIN para authenticated.
 *
 * Aquí: anon recibe 42501 «permission denied for table» en SELECT, INSERT, UPDATE y DELETE de
 * las 73 tablas (el permiso se comprueba antes que la RLS y que los datos). TRUNCATE y MAINTAIN
 * no los expone PostgREST: los comprueban la guarda de la migración y el ensayo, en el catálogo.
 *
 * Los filtros usan `IS NULL` sobre la primera columna de cada tabla: no convierte ningún literal
 * al tipo de la columna, así que el único error posible es el de permiso.
 *
 * Gateado (la migración la aplica Jose a mano): PRIVILEGIOS_TABLA_ANON_APPLIED=1
 */

const MIGRATION_APPLIED = process.env.PRIVILEGIOS_TABLA_ANON_APPLIED === '1'

/** Las 73 tablas de public. Las que no empiezan por `id` llevan su primera columna. */
const TABLAS_RAW: Array<string | [string, string]> = [
  'acuses_alta',
  'administraciones_medicacion',
  'agendas_diarias',
  'anuncios',
  'asignacion_concepto',
  'asistencias',
  'audit_log',
  'aulas',
  'aulas_curso',
  'ausencias',
  'auth_attempts',
  'autorizaciones',
  'beca_comedor_desborde',
  'beca_comedor_elegibilidad',
  'beca_comedor_tramo',
  'beca_comedor_transferencia',
  'becas',
  'biberones',
  'cambios_pendientes',
  'campanas_informe',
  'centros',
  'cierre_mensual',
  'cita_invitados',
  'citas',
  'comidas',
  'conceptos_cobro',
  'confirmaciones_evento',
  'consentimientos',
  'conversaciones',
  'cursos_academicos',
  'datos_pedagogicos_nino',
  'deposiciones',
  'dias_centro',
  'eventos',
  'export_log',
  'familia_tutores',
  'familias',
  'firmas_autorizacion',
  'info_medica_emergencia',
  'informes_evolucion',
  'invitaciones',
  'lectura_anuncio',
  'lectura_conversacion',
  'lineas_recibo',
  'lista_espera',
  'mandatos_sepa',
  'matriculas',
  'media',
  'media_etiquetas',
  'mensajes',
  'menu_dia',
  'metodo_pago_familia',
  'ninos',
  'olvido_solicitudes',
  'parte_servicio_diario',
  'plantillas_informe',
  'plantillas_menu_mensual',
  ['preferencias_usuario', 'usuario_id'],
  'profes_aulas',
  'publicaciones',
  'push_subscriptions',
  'recibos',
  'recibos_remesa',
  'recordatorios',
  'remesas',
  'retencion_ejecuciones',
  'roles_usuario',
  'rollover_finaliza',
  'suenos',
  'tarifa_concepto_anio',
  'tipos_beca',
  'usuarios',
  'vinculos_familiares',
]
const TABLAS: Array<[string, string]> = TABLAS_RAW.map((t) =>
  typeof t === 'string' ? [t, 'id'] : t
)

type Res = { error: { code?: string; message?: string } | null }

function expectDenegado(res: Res, tabla: string) {
  expect(res.error?.code).toBe('42501')
  expect(res.error?.message).toContain(`permission denied for table ${tabla}`)
}

describe.skipIf(!MIGRATION_APPLIED)('Privilegios de tabla — nada para anon', () => {
  let usuario: TestUser
  let autenticado: SupabaseClient
  let anon: SupabaseClient

  beforeAll(async () => {
    // Cliente sin tipar: la unión de 73 tablas revienta la instanciación de tipos (TS2589).
    anon = anonClient() as unknown as SupabaseClient
    usuario = await createTestUser({ nombre: 'Usuario Privilegios Tabla' })
    autenticado = (await clientFor(usuario)) as unknown as SupabaseClient
  }, 60_000)

  afterAll(async () => {
    await deleteTestUser(usuario.id)
  }, 60_000)

  it('son 73 tablas distintas', () => {
    expect(new Set(TABLAS.map(([t]) => t)).size).toBe(73)
  })

  it.each(TABLAS)('anon NO hace SELECT en %s', async (tabla, col) => {
    expectDenegado(await anon.from(tabla).select(col).limit(1), tabla)
  })

  it.each(TABLAS)('anon NO hace INSERT en %s', async (tabla) => {
    expectDenegado(await anon.from(tabla).insert({}), tabla)
  })

  it.each(TABLAS)('anon NO hace UPDATE en %s', async (tabla, col) => {
    expectDenegado(
      await anon
        .from(tabla)
        .update({ [col]: null })
        .is(col, null),
      tabla
    )
  })

  it.each(TABLAS)('anon NO hace DELETE en %s', async (tabla, col) => {
    expectDenegado(await anon.from(tabla).delete().is(col, null), tabla)
  })

  it('authenticated sigue leyendo (su fila de usuarios, por la RLS)', async () => {
    const { data, error } = await autenticado.from('usuarios').select('id').eq('id', usuario.id)
    expect(error).toBeNull()
    expect(data).toEqual([{ id: usuario.id }])
  })
})
