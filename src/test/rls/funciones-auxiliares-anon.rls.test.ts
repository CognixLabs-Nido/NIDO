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

/**
 * Las 46 funciones auxiliares de `public` cerradas a anon.
 *
 * Migración: 20261010130000_fix_funciones_auxiliares_anon
 *   - anon NO tiene EXECUTE en ninguna de las 46 (PostgREST → 42501 antes de entrar al cuerpo).
 *   - authenticated y service_role la conservan: la usan 74 policies TO authenticated, un CHECK,
 *     la app y tres triggers que corren con el rol de quien escribe.
 *
 * Con esta migración y #293/#295/#297 ninguna función de `public` que no sea de trigger queda
 * ejecutable por anon (la guarda de la migración lo comprueba en el catálogo).
 *
 * Guarda de regresión: los default privileges re-conceden EXECUTE a PUBLIC/anon a cada función
 * que se (re)crea. Si alguien reabre el permiso, este test se pone rojo. Ancla positiva: el mismo
 * cliente anon lee una tabla (0 filas, sin error), así que el 42501 es del permiso y no de un
 * cliente roto.
 *
 * Gateado (la migración la aplica Jose a mano): FUNCIONES_AUXILIARES_ANON_APPLIED=1
 */

const MIGRATION_APPLIED = process.env.FUNCIONES_AUXILIARES_ANON_APPLIED === '1'

// Cliente sin tipar: varias de las 46 no están en los tipos generados y la unión completa de
// funciones revienta la instanciación de tipos. Los nombres los fija la lista de abajo.
type Client = SupabaseClient
type Llamada = (c: Client) => PromiseLike<{ error: { code?: string; message?: string } | null }>

const id = () => randomUUID()
const hoy = () => new Date().toISOString().slice(0, 10)

/** Las 46 llamadas, con argumentos de relleno (la ACL se comprueba antes que el cuerpo). */
const FUNCIONES: Array<[string, Llamada]> = [
  // A. Traducen un id en otro
  ['centro_de_agenda', (c) => c.rpc('centro_de_agenda', { p_agenda_id: id() })],
  ['centro_de_aula', (c) => c.rpc('centro_de_aula', { p_aula_id: id() })],
  ['centro_de_cita', (c) => c.rpc('centro_de_cita', { p_cita_id: id() })],
  ['centro_de_concepto', (c) => c.rpc('centro_de_concepto', { p_concepto_id: id() })],
  ['centro_de_conversacion', (c) => c.rpc('centro_de_conversacion', { p_conversacion_id: id() })],
  ['centro_de_curso', (c) => c.rpc('centro_de_curso', { p_curso_id: id() })],
  ['centro_de_evento', (c) => c.rpc('centro_de_evento', { p_evento_id: id() })],
  ['centro_de_familia', (c) => c.rpc('centro_de_familia', { p_familia_id: id() })],
  ['centro_de_nino', (c) => c.rpc('centro_de_nino', { p_nino_id: id() })],
  ['centro_de_plantilla', (c) => c.rpc('centro_de_plantilla', { p_plantilla_id: id() })],
  ['centro_de_publicacion', (c) => c.rpc('centro_de_publicacion', { p_publicacion_id: id() })],
  ['centro_de_recibo', (c) => c.rpc('centro_de_recibo', { p_recibo_id: id() })],
  ['centro_de_remesa', (c) => c.rpc('centro_de_remesa', { p_remesa_id: id() })],
  ['familia_de_nino', (c) => c.rpc('familia_de_nino', { p_nino_id: id() })],
  ['familia_de_recibo', (c) => c.rpc('familia_de_recibo', { p_recibo_id: id() })],
  ['nino_de_agenda', (c) => c.rpc('nino_de_agenda', { p_agenda_id: id() })],
  ['nino_de_conversacion', (c) => c.rpc('nino_de_conversacion', { p_conversacion_id: id() })],
  ['nino_de_recibo', (c) => c.rpc('nino_de_recibo', { p_recibo_id: id() })],
  ['aula_de_publicacion', (c) => c.rpc('aula_de_publicacion', { p_publicacion_id: id() })],
  ['autor_de_publicacion', (c) => c.rpc('autor_de_publicacion', { p_publicacion_id: id() })],
  ['organizador_de_cita', (c) => c.rpc('organizador_de_cita', { p_cita_id: id() })],
  ['publicacion_de_media', (c) => c.rpc('publicacion_de_media', { p_media_id: id() })],
  ['fecha_de_agenda', (c) => c.rpc('fecha_de_agenda', { p_agenda_id: id() })],
  ['curso_activo_de_centro', (c) => c.rpc('curso_activo_de_centro', { p_centro_id: id() })],
  // B. Devuelven sí o no
  [
    'tiene_consentimiento',
    (c) => c.rpc('tiene_consentimiento', { p_usuario_id: id(), p_tipo: 'imagen' }),
  ],
  [
    'es_tutor_en_centro',
    (c) => c.rpc('es_tutor_en_centro', { p_tutor_id: id(), p_centro_id: id() }),
  ],
  ['tiene_consentimiento_imagen', (c) => c.rpc('tiene_consentimiento_imagen', { p_nino_id: id() })],
  [
    'existe_consentimiento_imagen',
    (c) => c.rpc('existe_consentimiento_imagen', { p_nino_id: id() }),
  ],
  ['nino_puede_aparecer', (c) => c.rpc('nino_puede_aparecer', { p_nino_id: id() })],
  [
    'medicacion_administrable_hoy',
    (c) => c.rpc('medicacion_administrable_hoy', { p_autorizacion_id: id() }),
  ],
  ['mes_cerrado', (c) => c.rpc('mes_cerrado', { p_centro_id: id(), p_anio: 2026, p_mes: 1 })],
  ['recibo_en_remesa', (c) => c.rpc('recibo_en_remesa', { p_recibo_id: id() })],
  [
    'autorizacion_aplica_a_nino',
    (c) => c.rpc('autorizacion_aplica_a_nino', { p_autorizacion_id: id(), p_nino_id: id() }),
  ],
  ['autorizacion_firmable', (c) => c.rpc('autorizacion_firmable', { p_autorizacion_id: id() })],
  [
    'autorizacion_plantilla_valida',
    (c) =>
      c.rpc('autorizacion_plantilla_valida', {
        p_plantilla_id: id(),
        p_centro_id: id(),
        p_tipo: 'salida',
      }),
  ],
  [
    'evento_aplica_a_nino',
    (c) => c.rpc('evento_aplica_a_nino', { p_evento_id: id(), p_nino_id: id() }),
  ],
  ['conversacion_activa', (c) => c.rpc('conversacion_activa', { p_conv_id: id() })],
  [
    'publicacion_tiene_nino_sin_permiso',
    (c) => c.rpc('publicacion_tiene_nino_sin_permiso', { p_publicacion_id: id() }),
  ],
  ['centro_abierto', (c) => c.rpc('centro_abierto', { p_centro_id: id(), p_fecha: hoy() })],
  ['dentro_de_ventana_edicion', (c) => c.rpc('dentro_de_ventana_edicion', { p_fecha: hoy() })],
  ['nino_toma_comida_solida', (c) => c.rpc('nino_toma_comida_solida', { p_nino_id: id() })],
  // C. Devuelven datos
  ['menu_del_dia', (c) => c.rpc('menu_del_dia', { p_centro_id: id(), p_fecha: hoy() })],
  ['tipo_de_dia', (c) => c.rpc('tipo_de_dia', { p_centro_id: id(), p_fecha: hoy() })],
  // D. No leen ninguna tabla
  ['_redactar_jsonb', (c) => c.rpc('_redactar_jsonb', { j: {}, claves: [] })],
  ['idiomas_iso_2letras', (c) => c.rpc('idiomas_iso_2letras', { p_codigos: ['es'] })],
  ['hoy_madrid', (c) => c.rpc('hoy_madrid')],
]

describe.skipIf(!MIGRATION_APPLIED)('Funciones auxiliares — las 46 cerradas a anon', () => {
  let usuario: TestUser
  let autenticado: Client
  let anon: Client

  beforeAll(async () => {
    anon = anonClient() as unknown as Client
    usuario = await createTestUser({ nombre: 'Usuario Funciones Auxiliares' })
    autenticado = (await clientFor(usuario)) as unknown as Client
  }, 60_000)

  afterAll(async () => {
    await deleteTestUser(usuario.id)
  }, 60_000)

  it('son 46 funciones distintas', () => {
    expect(new Set(FUNCIONES.map(([nombre]) => nombre)).size).toBe(46)
  })

  it('ancla: el cliente anon lee una tabla (0 filas, sin error)', async () => {
    const { data, error } = await anon.from('centros').select('id').limit(1)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it.each(FUNCIONES)('anon NO ejecuta %s (sin EXECUTE → 42501)', async (nombre, llamar) => {
    const { error } = await llamar(anon)
    expect(error?.code).toBe('42501')
    expect(error?.message).toContain(`permission denied for function ${nombre}`)
  })

  it.each(FUNCIONES)('authenticated sigue ejecutando %s', async (_nombre, llamar) => {
    const { error } = await llamar(autenticado)
    expect(error).toBeNull()
  })

  it.each(FUNCIONES)('service_role sigue ejecutando %s', async (_nombre, llamar) => {
    const { error } = await llamar(serviceClient as unknown as Client)
    expect(error).toBeNull()
  })
})
