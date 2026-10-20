import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarProfeAula,
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestFamilia,
  createTestUser,
  crearFamiliaTutor,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestAula,
  type TestCentro,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * PR 2a (Fase 4) — las funciones auxiliares solo contestan a quien es de su centro.
 *
 * Migración: 20261026120000_fix_funciones_auxiliares_centro
 *   - 11 sin ningún uso con sesión (`tiene_consentimiento` entre ellas): sin EXECUTE para
 *     `authenticated` (42501 de permiso).
 *   - 5 que la app llama y ninguna policy usa: quien no es del centro, 42501.
 *   - `curso_activo_de_centro` y `es_tutor_en_centro`, que usan policies: a quien no es del centro
 *     no le contestan nada (NULL, FALSE), sin abortar la consulta que las evalúa fila a fila.
 *
 * El control positivo (commit 8809681) demostró contra la BD efímera que la directora y una
 * familia del centro B recibían datos de A por las 18.
 */

// Cliente sin tipar: varias de estas funciones no están en los tipos generados.
type Client = SupabaseClient

let centroA: TestCentro
let centroB: TestCentro
let aulaA: TestAula
let ninoA: string
let familiaA: string
let tutorA: TestUser
let profeA: TestUser
let directoraA: TestUser
let superusuario: TestUser
let directoraB: TestUser
let tutorB: TestUser
let cliTutorA: Client
let cliProfeA: Client
let cliDirectoraA: Client
let cliSuper: Client
let cliDirectoraB: Client
let cliTutorB: Client

const FECHA_MENU = '2026-07-20'
const FECHA_FESTIVO = '2026-06-22'

/** Las 5 que la app llama por RPC y ninguna policy usa, con los datos de A que contestaban. */
const LAS_5: Array<[string, () => Record<string, unknown>, (data: unknown) => void]> = [
  [
    'menu_del_dia',
    () => ({ p_centro_id: centroA.id, p_fecha: FECHA_MENU }),
    (d) => expect((d as { comida_primero: string }).comida_primero).toBe('Lentejas'),
  ],
  [
    'tipo_de_dia',
    () => ({ p_centro_id: centroA.id, p_fecha: FECHA_FESTIVO }),
    (d) => expect(d).toBe('festivo'),
  ],
  [
    'mes_cerrado',
    () => ({ p_centro_id: centroA.id, p_anio: 2026, p_mes: 6 }),
    (d) => expect(d).toBe(true),
  ],
  ['existe_consentimiento_imagen', () => ({ p_nino_id: ninoA }), (d) => expect(d).toBe(true)],
  ['nino_toma_comida_solida', () => ({ p_nino_id: ninoA }), (d) => expect(d).toBe(false)],
]

/** Las 11 sin ningún uso con sesión. */
const LAS_11: Array<[string, () => Record<string, unknown>]> = [
  ['centro_abierto', () => ({ p_centro_id: centroA.id, p_fecha: FECHA_FESTIVO })],
  ['centro_de_conversacion', () => ({ p_conversacion_id: randomUUID() })],
  ['centro_de_curso', () => ({ p_curso_id: aulaA.curso_academico_id })],
  ['centro_de_remesa', () => ({ p_remesa_id: randomUUID() })],
  ['familia_de_nino', () => ({ p_nino_id: ninoA })],
  ['nino_de_conversacion', () => ({ p_conversacion_id: randomUUID() })],
  ['nino_de_recibo', () => ({ p_recibo_id: randomUUID() })],
  ['publicacion_tiene_nino_sin_permiso', () => ({ p_publicacion_id: randomUUID() })],
  ['recibo_en_remesa', () => ({ p_recibo_id: randomUUID() })],
  ['tiene_consentimiento_imagen', () => ({ p_nino_id: ninoA })],
  ['tiene_consentimiento', () => ({ p_usuario_id: tutorA.id, p_tipo: 'datos_medicos' })],
]

beforeAll(async () => {
  centroA = await createTestCentro('Auxiliares A')
  centroB = await createTestCentro('Auxiliares B')
  const cursoA = await createTestCurso(centroA.id)
  aulaA = await createTestAula(centroA.id, cursoA.id)

  // Centro A: una familia con su hijo, matriculado, con datos que solo A debería ver.
  tutorA = await createTestUser({ nombre: 'Tutor A Auxiliares' })
  await asignarRol(tutorA.id, centroA.id, 'tutor_legal')
  familiaA = await createTestFamilia(centroA.id)
  await crearFamiliaTutor(familiaA, tutorA.id, 'titular')
  const { data: nino } = await serviceClient
    .from('ninos')
    .insert({
      centro_id: centroA.id,
      familia_id: familiaA,
      nombre: `Hijo-${randomUUID().slice(0, 8)}`,
      apellidos: 'Apellido Test',
      fecha_nacimiento: '2024-03-15',
    })
    .select('id')
    .single()
  ninoA = nino!.id
  await crearVinculo(ninoA, tutorA.id, 'tutor_legal_principal')
  await matricular(ninoA, aulaA.id, cursoA.id)
  await serviceClient.from('datos_pedagogicos_nino').insert({
    nino_id: ninoA,
    lactancia_estado: 'materna',
    control_esfinteres: 'panal_completo',
    tipo_alimentacion: 'omnivora',
    idiomas_casa: ['es'],
    tiene_hermanos_en_centro: false,
  })
  await serviceClient.rpc('otorgar_consentimiento_imagen', { p_nino_id: ninoA, p_tutor: tutorA.id })
  cliTutorA = (await clientFor(tutorA)) as unknown as Client
  await cliTutorA.rpc('registrar_consentimiento', {
    p_usuario_id: tutorA.id,
    p_tipo: 'datos_medicos',
    p_version: 'v1.0',
  })
  const { data: plantilla } = await serviceClient
    .from('plantillas_menu_mensual')
    .insert({ centro_id: centroA.id, mes: 7, anio: 2026, estado: 'publicada' })
    .select('id')
    .single()
  await serviceClient.from('menu_dia').insert({
    plantilla_id: plantilla!.id,
    fecha: FECHA_MENU,
    comida_primero: 'Lentejas',
    comida_segundo: 'Filete con patatas',
    comida_postre: 'Fruta',
  })
  await serviceClient
    .from('dias_centro')
    .insert({ centro_id: centroA.id, fecha: FECHA_FESTIVO, tipo: 'festivo' })

  profeA = await createTestUser({ nombre: 'Profe A Auxiliares' })
  await asignarRol(profeA.id, centroA.id, 'profe')
  await asignarProfeAula(profeA.id, aulaA.id, cursoA.id)
  cliProfeA = (await clientFor(profeA)) as unknown as Client

  directoraA = await createTestUser({ nombre: 'Directora A Auxiliares' })
  await asignarRol(directoraA.id, centroA.id, 'admin')
  cliDirectoraA = (await clientFor(directoraA)) as unknown as Client
  await serviceClient
    .from('cierre_mensual')
    .insert({ centro_id: centroA.id, anio: 2026, mes: 6, cerrado_por: directoraA.id })

  // El superusuario no tiene ningún rol: entra por `es_admin` (ADR-0061).
  superusuario = await createTestUser({ nombre: 'Superusuario Auxiliares' })
  const { error: errSuper } = await serviceClient
    .from('platform_admins')
    .insert({ usuario_id: superusuario.id })
  if (errSuper) throw new Error(`sembrar superusuario falló: ${errSuper.message}`)
  cliSuper = (await clientFor(superusuario)) as unknown as Client

  // Centro B: su directora y una familia.
  directoraB = await createTestUser({ nombre: 'Directora B Auxiliares' })
  await asignarRol(directoraB.id, centroB.id, 'admin')
  tutorB = await createTestUser({ nombre: 'Tutor B Auxiliares' })
  await asignarRol(tutorB.id, centroB.id, 'tutor_legal')
  cliDirectoraB = (await clientFor(directoraB)) as unknown as Client
  cliTutorB = (await clientFor(tutorB)) as unknown as Client
}, 120_000)

afterAll(async () => {
  await serviceClient.from('platform_admins').delete().eq('usuario_id', superusuario.id)
  await serviceClient.from('cierre_mensual').delete().eq('centro_id', centroA.id)
  await serviceClient.from('dias_centro').delete().eq('centro_id', centroA.id)
  await serviceClient.from('plantillas_menu_mensual').delete().eq('centro_id', centroA.id)
  await serviceClient.from('consentimientos').delete().eq('usuario_id', tutorA.id)
  for (const u of [tutorA, profeA, directoraA, superusuario, directoraB, tutorB])
    if (u) await deleteTestUser(u.id)
  await deleteTestCentro(centroA.id)
  await deleteTestCentro(centroB.id)
}, 120_000)

describe('PR 2a — las funciones auxiliares solo contestan a su centro', () => {
  it('premisa: los de B no tienen ningún rol en A, y el superusuario ninguno en ningún sitio', async () => {
    const { count } = await serviceClient
      .from('roles_usuario')
      .select('id', { count: 'exact', head: true })
      .in('usuario_id', [directoraB.id, tutorB.id])
      .eq('centro_id', centroA.id)
    expect(count).toBe(0)
    const { count: delSuper } = await serviceClient
      .from('roles_usuario')
      .select('id', { count: 'exact', head: true })
      .eq('usuario_id', superusuario.id)
    expect(delSuper).toBe(0)
  })

  it.each(LAS_5)('%s: B recibe 42501', async (nombre, args) => {
    for (const c of [cliDirectoraB, cliTutorB]) {
      const { data, error } = await c.rpc(nombre, args())
      expect(error?.code).toBe('42501')
      expect(error?.message).toContain('no es de este centro')
      expect(data).toBeNull()
    }
  })

  it.each(LAS_5)(
    '%s: la familia, la profe, la directora y el superusuario de A, y el servicio, sí',
    async (nombre, args, esDeA) => {
      for (const c of [
        cliTutorA,
        cliProfeA,
        cliDirectoraA,
        cliSuper,
        serviceClient as unknown as Client,
      ]) {
        const { data, error } = await c.rpc(nombre, args())
        expect(error).toBeNull()
        esDeA(data)
      }
    }
  )

  it('menu_del_dia sin menú contesta lo mismo que antes: una fila con todo a NULL', async () => {
    // Medido el 2026-10-20 con la versión `sql` y con la `plpgsql`: una función que devuelve un
    // tipo compuesto llega por PostgREST como una fila, y sin menú todos sus campos son NULL.
    const { data, error } = await cliTutorA.rpc('menu_del_dia', {
      p_centro_id: centroA.id,
      p_fecha: '2026-08-03',
    })
    expect(error).toBeNull()
    expect(data).not.toBeNull()
    expect((data as { id: string | null }).id).toBeNull()
  })

  it('curso_activo_de_centro: a B no le contesta (NULL); a los de A y al servicio, el curso', async () => {
    for (const c of [cliDirectoraB, cliTutorB]) {
      const { data, error } = await c.rpc('curso_activo_de_centro', { p_centro_id: centroA.id })
      expect(error).toBeNull()
      expect(data).toBeNull()
    }
    for (const c of [
      cliTutorA,
      cliProfeA,
      cliDirectoraA,
      cliSuper,
      serviceClient as unknown as Client,
    ]) {
      const { data } = await c.rpc('curso_activo_de_centro', { p_centro_id: centroA.id })
      expect(data).toBe(aulaA.curso_academico_id)
    }
  })

  it('es_tutor_en_centro: de sí mismo o la directora del centro; a B, FALSE', async () => {
    const pregunta = { p_tutor_id: tutorA.id, p_centro_id: centroA.id }
    for (const c of [cliDirectoraB, cliTutorB, cliProfeA]) {
      const { data, error } = await c.rpc('es_tutor_en_centro', pregunta)
      expect(error).toBeNull()
      expect(data).toBe(false)
    }
    for (const c of [cliTutorA, cliDirectoraA, cliSuper, serviceClient as unknown as Client]) {
      expect((await c.rpc('es_tutor_en_centro', pregunta)).data).toBe(true)
    }
  })

  it('las 11 sin uso con sesión: 42501 de permiso para cualquiera con sesión, también de A', async () => {
    expect(new Set(LAS_11.map(([n]) => n)).size).toBe(11)
    for (const [nombre, args] of LAS_11) {
      // El tutor de A pregunta también por su propio consentimiento: tampoco.
      for (const c of [cliTutorB, cliTutorA, cliDirectoraA, cliSuper]) {
        const { error } = await c.rpc(nombre, args())
        expect(error?.code, nombre).toBe('42501')
        expect(error?.message, nombre).toContain(`permission denied for function ${nombre}`)
      }
    }
  })

  it('las 11: el servicio las sigue ejecutando', async () => {
    for (const [nombre, args] of LAS_11) {
      const { error } = await serviceClient.rpc(nombre as never, args() as never)
      expect(error, nombre).toBeNull()
    }
    expect((await serviceClient.rpc('familia_de_nino', { p_nino_id: ninoA })).data).toBe(familiaA)
    expect(
      (
        await serviceClient.rpc('tiene_consentimiento', {
          p_usuario_id: tutorA.id,
          p_tipo: 'datos_medicos',
        })
      ).data
    ).toBe(true)
  })

  it('control: la profe de A ve la matrícula de su aula, y B la recorre sin error y no la ve', async () => {
    const deA = await cliProfeA.from('matriculas').select('id').eq('nino_id', ninoA)
    expect(deA.error).toBeNull()
    expect(deA.data).toHaveLength(1)

    for (const c of [cliDirectoraB, cliTutorB]) {
      const deB = await c.from('matriculas').select('id').eq('nino_id', ninoA)
      expect(deB.error).toBeNull()
      expect(deB.data).toHaveLength(0)
    }
  })
})
