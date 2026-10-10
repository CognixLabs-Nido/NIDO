import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  anonClient,
  clientFor,
  createTestUser,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Limpieza de seguridad PR-3 (grupo C) — policies de la app a TO authenticated y los 20 helpers
 * de RLS cerrados a anon.
 *
 * Migración: 20261002160000_fix_policies_authenticated_helpers_anon
 *   - Las 156 policies del esquema public que eran TO public pasan a TO authenticated (USING y
 *     WITH CHECK intactos). anon ya no las evalúa: default deny → 0 filas, sin llamar a helpers.
 *   - REVOKE EXECUTE de PUBLIC/anon en los 20 helpers; authenticated y service_role lo conservan
 *     (las policies los evalúan con el rol de quien consulta y la app llama a 5 directamente).
 *
 * Guardas de regresión:
 *   1. anon NO ejecuta ninguno de los 20 por RPC (42501 «permission denied for function»).
 *   2. anon lee las tablas de esas policies y obtiene 0 filas SIN error. Si alguien vuelve a
 *      crear una policy TO public que llame a un helper, anon recibirá «permission denied for
 *      function» en esa tabla y este test se pone rojo (el 42501 delataría qué está protegido).
 *   3. authenticated sigue: llama a es_admin y lee su propia fila de usuarios (policy «self»).
 *
 * audit_log queda fuera de la lista: anon no tiene GRANT de tabla desde #283 (42501 de tabla,
 * anterior a este cambio y ajeno a los helpers). matriculas, igual desde 20261009120000
 * (permiso por columna: anon sin SELECT de tabla → 42501, guarda propia abajo).
 *
 * Gateado (la migración la aplica Jose a mano): RLS_HELPERS_ANON_APPLIED=1
 */

const MIGRATION_APPLIED = process.env.RLS_HELPERS_ANON_APPLIED === '1'

type Client = SupabaseClient<Database>
type Tabla = keyof Database['public']['Tables']
type Llamada = (c: Client) => PromiseLike<{ error: { code?: string; message?: string } | null }>

const id = () => randomUUID()

/** Los 20 helpers, con argumentos de relleno (la ACL se comprueba antes que el cuerpo). */
const HELPERS: Array<[string, Llamada]> = [
  ['es_admin', (c) => c.rpc('es_admin', { p_centro_id: id() })],
  ['es_profe_de_aula', (c) => c.rpc('es_profe_de_aula', { p_aula_id: id() })],
  ['es_profe_de_evento', (c) => c.rpc('es_profe_de_evento', { p_evento_id: id() })],
  ['es_profe_de_nino', (c) => c.rpc('es_profe_de_nino', { p_nino_id: id() })],
  ['es_profe_en_centro', (c) => c.rpc('es_profe_en_centro', { p_centro_id: id() })],
  ['es_redactor_de_aula', (c) => c.rpc('es_redactor_de_aula', { p_aula_id: id() })],
  ['es_redactor_de_nino', (c) => c.rpc('es_redactor_de_nino', { p_nino_id: id() })],
  ['es_tutor_de', (c) => c.rpc('es_tutor_de', { p_nino_id: id() })],
  ['es_tutor_en_aula', (c) => c.rpc('es_tutor_en_aula', { p_aula_id: id() })],
  ['pertenece_a_centro', (c) => c.rpc('pertenece_a_centro', { p_centro_id: id() })],
  [
    'puede_participar_conversacion',
    (c) => c.rpc('puede_participar_conversacion', { p_conversacion_id: id() }),
  ],
  [
    'puede_postear_en_conversacion',
    (c) => c.rpc('puede_postear_en_conversacion', { p_conversacion_id: id() }),
  ],
  [
    'tiene_permiso_sobre',
    (c) => c.rpc('tiene_permiso_sobre', { p_nino_id: id(), p_permiso: 'puede_ver_agenda' }),
  ],
  [
    'usuario_es_audiencia_anuncio',
    (c) => c.rpc('usuario_es_audiencia_anuncio', { p_anuncio_id: id() }),
  ],
  [
    'usuario_es_audiencia_anuncio_row',
    (c) =>
      c.rpc('usuario_es_audiencia_anuncio_row', {
        p_centro_id: id(),
        p_autor_id: id(),
        p_ambito: 'centro',
        p_aula_id: id(),
      }),
  ],
  [
    'usuario_es_audiencia_autorizacion_row',
    (c) =>
      c.rpc('usuario_es_audiencia_autorizacion_row', {
        p_centro_id: id(),
        p_tipo: 'salida',
        p_es_plantilla: false,
        p_ambito: 'centro',
        p_evento_id: id(),
        p_nino_id: id(),
        p_aula_id: id(),
      }),
  ],
  [
    'usuario_es_audiencia_cita_row',
    (c) =>
      c.rpc('usuario_es_audiencia_cita_row', {
        p_centro_id: id(),
        p_organizador_id: id(),
        p_cita_id: id(),
      }),
  ],
  [
    'usuario_es_audiencia_evento_row',
    (c) =>
      c.rpc('usuario_es_audiencia_evento_row', {
        p_centro_id: id(),
        p_ambito: 'centro',
        p_aula_id: id(),
        p_nino_id: id(),
      }),
  ],
  [
    'usuario_es_audiencia_informe_row',
    (c) =>
      c.rpc('usuario_es_audiencia_informe_row', {
        p_centro_id: id(),
        p_nino_id: id(),
        p_estado: 'publicado',
      }),
  ],
  [
    'usuario_ve_publicacion_row',
    (c) =>
      c.rpc('usuario_ve_publicacion_row', {
        p_centro_id: id(),
        p_aula_id: id(),
        p_publicacion_id: id(),
      }),
  ],
]

/** Las tablas de las 156 policies (menos audit_log, ver arriba). */
const TABLAS: Tabla[] = [
  'acuses_alta',
  'administraciones_medicacion',
  'agendas_diarias',
  'anuncios',
  'asistencias',
  'aulas',
  'aulas_curso',
  'ausencias',
  'autorizaciones',
  'beca_comedor_desborde',
  'beca_comedor_elegibilidad',
  'beca_comedor_tramo',
  'beca_comedor_transferencia',
  'biberones',
  'campanas_informe',
  'centros',
  'cita_invitados',
  'citas',
  'comidas',
  'confirmaciones_evento',
  'consentimientos',
  'conversaciones',
  'cursos_academicos',
  'deposiciones',
  'dias_centro',
  'eventos',
  'export_log',
  'firmas_autorizacion',
  'info_medica_emergencia',
  'informes_evolucion',
  'invitaciones',
  'lectura_anuncio',
  'lectura_conversacion',
  'lista_espera',
  'media',
  'media_etiquetas',
  'mensajes',
  'menu_dia',
  'ninos',
  'olvido_solicitudes',
  'plantillas_informe',
  'plantillas_menu_mensual',
  'preferencias_usuario',
  'profes_aulas',
  'publicaciones',
  'push_subscriptions',
  'recordatorios',
  'retencion_ejecuciones',
  'roles_usuario',
  'rollover_finaliza',
  'suenos',
  'tarifa_concepto_anio',
  'usuarios',
  'vinculos_familiares',
]

describe.skipIf(!MIGRATION_APPLIED)(
  'Helpers de RLS — cerrados a anon, policies TO authenticated',
  () => {
    let usuario: TestUser
    let autenticado: Client
    let anon: Client

    beforeAll(async () => {
      anon = anonClient()
      usuario = await createTestUser({ nombre: 'Usuario RLS Helpers' })
      autenticado = await clientFor(usuario)
    }, 60_000)

    afterAll(async () => {
      await deleteTestUser(usuario.id)
    }, 60_000)

    it('son 20 helpers distintos y 54 tablas distintas', () => {
      expect(new Set(HELPERS.map(([nombre]) => nombre)).size).toBe(20)
      expect(new Set(TABLAS).size).toBe(54)
    })

    // Ancla: hasta 20261010130000 era la RPC abierta `hoy_madrid`; ya no queda ninguna función de
    // public que anon pueda ejecutar, así que el ancla es leer una tabla (0 filas, sin error).
    it('ancla: el cliente anon lee una tabla (0 filas, sin error)', async () => {
      const { data, error } = await anon.from('centros').select('id').limit(1)
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it.each(HELPERS)('anon NO ejecuta %s (sin EXECUTE → 42501)', async (nombre, llamar) => {
      const { error } = await llamar(anon)
      expect(error?.code).toBe('42501')
      expect(error?.message).toContain(`permission denied for function ${nombre}`)
    })

    it('anon NO lee matriculas: sin SELECT de tabla desde 20261009120000 (42501)', async () => {
      const { error } = await anon.from('matriculas').select('id').limit(1)
      expect(error?.code).toBe('42501')
      expect(error?.message).toContain('permission denied for table matriculas')
    })

    it.each(TABLAS)('anon lee %s: 0 filas y sin error (no evalúa helpers)', async (tabla) => {
      // Cliente sin tipar SOLO aquí: `from()` con la unión de 54 tablas revienta la instanciación
      // de tipos (TS2589). Los nombres ya los valida el tipo `Tabla[]` de TABLAS.
      const { data, error } = await (anon as unknown as SupabaseClient)
        .from(tabla)
        .select('*')
        .limit(1)
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('authenticated sigue ejecutando es_admin (→ false en un centro ajeno)', async () => {
      const { data, error } = await autenticado.rpc('es_admin', { p_centro_id: id() })
      expect(error).toBeNull()
      expect(data).toBe(false)
    })

    it('authenticated lee su propia fila de usuarios (policy «self», ahora TO authenticated)', async () => {
      const { data, error } = await autenticado.from('usuarios').select('id').eq('id', usuario.id)
      expect(error).toBeNull()
      expect(data).toEqual([{ id: usuario.id }])
    })

    it('service_role sigue ejecutando es_admin', async () => {
      const { error } = await serviceClient.rpc('es_admin', { p_centro_id: id() })
      expect(error).toBeNull()
    })
  }
)
