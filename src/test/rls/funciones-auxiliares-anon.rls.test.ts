import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  anonClient,
  expectLecturaAnonDenegada,
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
 *   - Salvo 11 sin ningún uso con sesión, que desde 20261026120000 (PR 2a de la Fase 4) solo
 *     ejecuta service_role. Otras 5 comprueban el centro de quien llama y con ids de relleno
 *     abortan: las prueba `funciones-auxiliares-centro.rls.test.ts`.
 *   - Y 24 que usan policies, que desde 20261028120000 (PR 2b) viven en el esquema `privado`: la
 *     API ya no las encuentra (PGRST202) con ninguna clave. Las prueba
 *     `funciones-esquema-privado.rls.test.ts`; aquí solo se comprueba que son esas 24.
 *
 * Con esta migración y #293/#295/#297 ninguna función de `public` que no sea de trigger queda
 * ejecutable por anon (la guarda de la migración lo comprueba en el catálogo).
 *
 * Guarda de regresión: los default privileges re-conceden EXECUTE a PUBLIC/anon a cada función
 * que se (re)crea. Si alguien reabre el permiso, este test se pone rojo. Ancla positiva: el mismo
 * cliente anon lee una tabla (0 filas, sin error), así que el 42501 es del permiso y no de un
 * cliente roto.
 */

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

/** Sin ningún uso con sesión: desde 20261026120000 solo las ejecuta service_role. */
const SIN_SESION = new Set([
  'centro_abierto',
  'centro_de_conversacion',
  'centro_de_curso',
  'centro_de_remesa',
  'familia_de_nino',
  'nino_de_conversacion',
  'nino_de_recibo',
  'publicacion_tiene_nino_sin_permiso',
  'recibo_en_remesa',
  'tiene_consentimiento_imagen',
  'tiene_consentimiento',
])

/** Comprueban el centro de quien llama (20261026120000): con ids de relleno, 42501. */
const CON_COMPROBACION = new Set([
  'menu_del_dia',
  'tipo_de_dia',
  'mes_cerrado',
  'existe_consentimiento_imagen',
  'nino_toma_comida_solida',
])

/** En el esquema `privado` desde 20261028120000 (PR 2b): fuera de la API. */
const EN_PRIVADO = new Set([
  'aula_de_publicacion',
  'autor_de_publicacion',
  'autorizacion_aplica_a_nino',
  'autorizacion_firmable',
  'autorizacion_plantilla_valida',
  'centro_de_agenda',
  'centro_de_aula',
  'centro_de_cita',
  'centro_de_concepto',
  'centro_de_evento',
  'centro_de_familia',
  'centro_de_nino',
  'centro_de_plantilla',
  'centro_de_publicacion',
  'centro_de_recibo',
  'conversacion_activa',
  'evento_aplica_a_nino',
  'familia_de_recibo',
  'fecha_de_agenda',
  'medicacion_administrable_hoy',
  'nino_de_agenda',
  'nino_puede_aparecer',
  'organizador_de_cita',
  'publicacion_de_media',
])

/** Las que siguen en `public`, a las que se les prueban los permisos. */
const EN_PUBLIC = FUNCIONES.filter(([n]) => !EN_PRIVADO.has(n))

describe('Funciones auxiliares — las 46 cerradas a anon', () => {
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

  // Ancla: anon no puede ejecutar ninguna función de public (20261010130000) ni, desde
  // 20261010140000, tocar ninguna tabla. El 42501 «permission denied for table» solo lo devuelve
  // Postgres a través de PostgREST: prueba que el cliente llega a la BD y que el rechazo es del
  // permiso. Antes de esa migración (flag apagado) anon leía 0 filas sin error.
  it('ancla: el cliente anon llega a la BD (lectura de tabla denegada por permiso)', async () => {
    expectLecturaAnonDenegada(await anon.from('centros').select('id').limit(1), 'centros')
  })

  it('las 24 movidas a privado están en la lista, y quedan 22 en public', () => {
    const nombres = new Set(FUNCIONES.map(([nombre]) => nombre))
    for (const n of EN_PRIVADO) expect(nombres.has(n), n).toBe(true)
    expect(EN_PRIVADO.size).toBe(24)
    expect(EN_PUBLIC).toHaveLength(22)
  })

  it.each(EN_PUBLIC)('anon NO ejecuta %s (sin EXECUTE → 42501)', async (nombre, llamar) => {
    const { error } = await llamar(anon)
    expect(error?.code).toBe('42501')
    expect(error?.message).toContain(`permission denied for function ${nombre}`)
  })

  it('las 11 sin uso con sesión y las 5 con comprobación están en la lista', () => {
    const nombres = new Set(FUNCIONES.map(([nombre]) => nombre))
    for (const n of [...SIN_SESION, ...CON_COMPROBACION]) expect(nombres.has(n), n).toBe(true)
    expect(SIN_SESION.size).toBe(11)
    expect(CON_COMPROBACION.size).toBe(5)
  })

  it.each(EN_PUBLIC.filter(([n]) => !SIN_SESION.has(n) && !CON_COMPROBACION.has(n)))(
    'authenticated sigue ejecutando %s',
    async (_nombre, llamar) => {
      const { error } = await llamar(autenticado)
      expect(error).toBeNull()
    }
  )

  it.each(FUNCIONES.filter(([n]) => SIN_SESION.has(n)))(
    'authenticated ya no ejecuta %s (20261026120000)',
    async (nombre, llamar) => {
      const { error } = await llamar(autenticado)
      expect(error?.code).toBe('42501')
      expect(error?.message).toContain(`permission denied for function ${nombre}`)
    }
  )

  it.each(EN_PUBLIC)('service_role sigue ejecutando %s', async (_nombre, llamar) => {
    const { error } = await llamar(serviceClient as unknown as Client)
    expect(error).toBeNull()
  })
})
