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
 * Limpieza de seguridad PR-2 — las 35 RPCs del grupo B cerradas a anon.
 *
 * Migración: 20261002150000_fix_rpc_grupo_b_anon
 *   - anon NO tiene EXECUTE en ninguna de las 35 (PostgREST → 42501 antes de entrar al cuerpo).
 *   - authenticated y service_role la conservan: las llaman la app y el servidor.
 *
 * Guarda de regresión: los default privileges re-conceden EXECUTE a PUBLIC/anon a cada función
 * que se (re)crea. Si alguien reabre el permiso, este test se pone rojo. Ancla positiva: el mismo
 * cliente anon SÍ ejecuta una RPC abierta (`hoy_madrid`), así que el 42501 es del permiso y no de
 * un cliente roto. Varias de estas funciones lanzan 42501 desde su propia guarda, así que se
 * afirma también el mensaje de permiso («permission denied for function»).
 *
 * Los flujos legítimos (alta, recibos, médico, SEPA, matrícula) los cubrió el ensayo con rollback
 * contra el remoto (body del PR); aquí solo se ancla que authenticated y service_role siguen
 * entrando.
 *
 * Gateado (la migración la aplica Jose a mano): RPC_GRUPO_B_ANON_APPLIED=1
 */

const MIGRATION_APPLIED = process.env.RPC_GRUPO_B_ANON_APPLIED === '1'

type Client = SupabaseClient<Database>
type Llamada = (c: Client) => PromiseLike<{ error: { code?: string; message?: string } | null }>

const id = () => randomUUID()
const hoy = () => new Date().toISOString().slice(0, 10)

const MANDATO = () => ({
  p_familia_id: id(),
  p_nino_id: id(),
  p_iban: 'ES9121000418450200051332',
  p_titular: 'Titular Test',
  p_identificador_mandato: `MAND-${id()}`,
  p_documento_path: 'x',
  p_firma_imagen: 'x',
  p_nombre_tecleado: 'x',
  p_texto_hash: 'x',
  p_ip_address: '127.0.0.1',
  p_user_agent: 'vitest',
  p_fecha_firma: new Date().toISOString(),
})

const MEDICA = () => ({
  p_nino_id: id(),
  p_alergias_graves: 'x',
  p_notas_emergencia: 'x',
  p_medicacion_habitual: 'x',
  p_alergias_leves: 'x',
  p_medico_familia: 'x',
  p_telefono_emergencia: 'x',
})

/** Las 35 llamadas, con argumentos de relleno (la ACL se comprueba antes que el cuerpo). */
const GRUPO_B: Array<[string, Llamada]> = [
  // Alta / niño
  [
    'crear_o_anadir_a_familia',
    (c) =>
      c.rpc('crear_o_anadir_a_familia', {
        p_nombre_nino: 'x',
        p_apellidos_nino: 'x',
        p_fecha_nacimiento: hoy(),
        p_centro_id: id(),
        p_aula_id: id(),
        p_tutor_email: 'x@nido.test',
        p_tutor_nombre_completo: 'x',
        p_parentesco: 'madre',
        p_descripcion_parentesco: 'x',
        p_usuario_id: id(),
        p_permisos: {},
      }),
  ],
  ['marcar_matricula_lista', (c) => c.rpc('marcar_matricula_lista', { p_nino_id: id() })],
  ['baja_nino', (c) => c.rpc('baja_nino', { p_nino_id: id(), p_motivo: 'x' })],
  [
    'archivar_nino',
    (c) => c.rpc('archivar_nino', { p_nino_id: id(), p_motivo: 'x', p_fecha_baja: hoy() }),
  ],
  ['desarchivar_nino', (c) => c.rpc('desarchivar_nino', { p_nino_id: id(), p_aula_id: id() })],
  ['revocar_acceso_familia', (c) => c.rpc('revocar_acceso_familia', { p_familia_id: id() })],
  ['cerrar_curso', (c) => c.rpc('cerrar_curso', { p_curso_destino_id: id() })],
  ['proponer_asignaciones', (c) => c.rpc('proponer_asignaciones', { p_centro_id: id() })],
  ['reproponer_asignaciones', (c) => c.rpc('reproponer_asignaciones', { p_centro_id: id() })],
  // Recibos / SEPA
  [
    'generar_recibos_mes',
    (c) => c.rpc('generar_recibos_mes', { p_centro_id: id(), p_anio: 2026, p_mes: 1 }),
  ],
  [
    'crear_recibo_esporadico',
    (c) =>
      c.rpc('crear_recibo_esporadico', {
        p_centro_id: id(),
        p_familia_id: id(),
        p_nino_id: id(),
        p_anio: 2026,
        p_mes: 1,
        p_concepto: 'x',
        p_metodo: 'x',
        p_lineas: [],
      }),
  ],
  ['confirmar_recibo', (c) => c.rpc('confirmar_recibo', { p_recibo_id: id() })],
  ['desconfirmar_recibo', (c) => c.rpc('desconfirmar_recibo', { p_recibo_id: id() })],
  ['get_mandatos_remesa', (c) => c.rpc('get_mandatos_remesa', { p_remesa_id: id() })],
  ['get_datos_acreedor', (c) => c.rpc('get_datos_acreedor', { p_centro_id: id() })],
  [
    'set_datos_acreedor',
    (c) =>
      c.rpc('set_datos_acreedor', {
        p_centro_id: id(),
        p_identificador_acreedor: 'x',
        p_bic_acreedor: 'x',
        p_iban: 'x',
      }),
  ],
  ['registrar_mandato_sepa', (c) => c.rpc('registrar_mandato_sepa', MANDATO())],
  ['sustituir_mandato_sepa', (c) => c.rpc('sustituir_mandato_sepa', MANDATO())],
  // Médico / datos del niño por el tutor
  ['get_info_medica_emergencia', (c) => c.rpc('get_info_medica_emergencia', { p_nino_id: id() })],
  [
    'set_info_medica_emergencia_cifrada',
    (c) => c.rpc('set_info_medica_emergencia_cifrada', MEDICA()),
  ],
  [
    'set_info_medica_emergencia_cifrada_tutor',
    (c) => c.rpc('set_info_medica_emergencia_cifrada_tutor', MEDICA()),
  ],
  [
    'borrar_info_medica_nino_tutor',
    (c) => c.rpc('borrar_info_medica_nino_tutor', { p_nino_id: id() }),
  ],
  [
    'actualizar_foto_nino_tutor',
    (c) => c.rpc('actualizar_foto_nino_tutor', { p_nino_id: id(), p_foto_path: 'x' }),
  ],
  [
    'actualizar_identidad_nino_tutor',
    (c) =>
      c.rpc('actualizar_identidad_nino_tutor', {
        p_nino_id: id(),
        p_nombre: 'x',
        p_apellidos: 'x',
        p_fecha_nacimiento: hoy(),
        p_sexo: 'X',
        p_nacionalidad: 'x',
        p_idioma_principal: 'x',
      }),
  ],
  // Consentimientos / autorizaciones / imagen
  ['revocar_consentimiento', (c) => c.rpc('revocar_consentimiento', { p_tipo: 'terminos' })],
  ['archivar_autorizacion', (c) => c.rpc('archivar_autorizacion', { p_autorizacion_id: id() })],
  [
    'resolver_etiqueta_imagen',
    (c) => c.rpc('resolver_etiqueta_imagen', { p_media_etiqueta_id: id() }),
  ],
  // Contadores del nav
  ['contar_invitaciones_pendientes', (c) => c.rpc('contar_invitaciones_pendientes')],
  ['contar_recordatorios_pendientes', (c) => c.rpc('contar_recordatorios_pendientes')],
  // Helpers sin policy TO public
  ['es_tutor_de_familia', (c) => c.rpc('es_tutor_de_familia', { p_familia_id: id() })],
  ['es_tutor_legal_de', (c) => c.rpc('es_tutor_legal_de', { p_nino_id: id() })],
  ['familia_ve_aula', (c) => c.rpc('familia_ve_aula', { p_aula_id: id() })],
  [
    'publicacion_etiqueta_hijo_de',
    (c) => c.rpc('publicacion_etiqueta_hijo_de', { p_publicacion_id: id() }),
  ],
  ['usuario_es_invitado_cita', (c) => c.rpc('usuario_es_invitado_cita', { p_cita_id: id() })],
  ['usuario_actual', (c) => c.rpc('usuario_actual')],
]

describe.skipIf(!MIGRATION_APPLIED)('RPCs del grupo B — cerradas a anon', () => {
  let usuario: TestUser
  let autenticado: Client
  let anon: Client

  beforeAll(async () => {
    anon = anonClient()
    usuario = await createTestUser({ nombre: 'Usuario RPC Grupo B' })
    autenticado = await clientFor(usuario)
  }, 60_000)

  afterAll(async () => {
    await deleteTestUser(usuario.id)
  }, 60_000)

  it('son 35 funciones distintas', () => {
    expect(new Set(GRUPO_B.map(([nombre]) => nombre)).size).toBe(35)
  })

  it('ancla: el cliente anon SÍ ejecuta una RPC abierta (hoy_madrid)', async () => {
    const { data, error } = await anon.rpc('hoy_madrid')
    expect(error).toBeNull()
    expect(data).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it.each(GRUPO_B)('anon NO ejecuta %s (sin EXECUTE → 42501)', async (nombre, llamar) => {
    const { error } = await llamar(anon)
    expect(error?.code).toBe('42501')
    expect(error?.message).toContain(`permission denied for function ${nombre}`)
  })

  it('authenticated sigue ejecutando: usuario_actual devuelve su id', async () => {
    const { data, error } = await autenticado.rpc('usuario_actual')
    expect(error).toBeNull()
    expect(data).toBe(usuario.id)
  })

  it('authenticated sigue ejecutando un helper: es_tutor_legal_de → false', async () => {
    const { data, error } = await autenticado.rpc('es_tutor_legal_de', { p_nino_id: id() })
    expect(error).toBeNull()
    expect(data).toBe(false)
  })

  it('service_role sigue ejecutando: es_tutor_legal_de → false', async () => {
    const { data, error } = await serviceClient.rpc('es_tutor_legal_de', { p_nino_id: id() })
    expect(error).toBeNull()
    expect(data).toBe(false)
  })
})
