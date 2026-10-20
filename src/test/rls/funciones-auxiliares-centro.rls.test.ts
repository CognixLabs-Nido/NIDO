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
 * PR 2a (Fase 4) — funciones auxiliares que contestaban a cualquiera con sesión, fuera cual
 * fuera su centro. CONTROL POSITIVO: aquí se demuestra el ataque contra la BD efímera, con
 * la directora y una familia del centro B preguntando por el centro A.
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
let directoraB: TestUser
let tutorB: TestUser
let cliDirectoraB: Client
let cliTutorB: Client

const FECHA_MENU = '2026-07-20'
const FECHA_FESTIVO = '2026-06-22'

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
  const cliTutorA = await clientFor(tutorA)
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

  const directoraA = await createTestUser({ nombre: 'Directora A Auxiliares' })
  await asignarRol(directoraA.id, centroA.id, 'admin')
  await serviceClient
    .from('cierre_mensual')
    .insert({ centro_id: centroA.id, anio: 2026, mes: 6, cerrado_por: directoraA.id })
  await deleteTestUser(directoraA.id)

  // Centro B: su directora y una familia.
  directoraB = await createTestUser({ nombre: 'Directora B Auxiliares' })
  await asignarRol(directoraB.id, centroB.id, 'admin')
  tutorB = await createTestUser({ nombre: 'Tutor B Auxiliares' })
  await asignarRol(tutorB.id, centroB.id, 'tutor_legal')
  cliDirectoraB = (await clientFor(directoraB)) as unknown as Client
  cliTutorB = (await clientFor(tutorB)) as unknown as Client
}, 120_000)

afterAll(async () => {
  for (const u of [tutorA, profeA, directoraB, tutorB]) if (u) await deleteTestUser(u.id)
  await serviceClient.from('cierre_mensual').delete().eq('centro_id', centroA.id)
  await serviceClient.from('dias_centro').delete().eq('centro_id', centroA.id)
  await serviceClient.from('plantillas_menu_mensual').delete().eq('centro_id', centroA.id)
  await serviceClient.from('consentimientos').delete().eq('usuario_id', tutorA.id)
  await deleteTestCentro(centroA.id)
  await deleteTestCentro(centroB.id)
}, 120_000)

describe('PR 2a — control positivo: el centro B pregunta por el centro A', () => {
  it('premisa: los de B no tienen ningún rol en A', async () => {
    const { count } = await serviceClient
      .from('roles_usuario')
      .select('id', { count: 'exact', head: true })
      .in('usuario_id', [directoraB.id, tutorB.id])
      .eq('centro_id', centroA.id)
    expect(count).toBe(0)
  })

  it('las 5 que la app llama por RPC le contestan a B con datos de A', async () => {
    for (const c of [cliDirectoraB, cliTutorB]) {
      const menu = await c.rpc('menu_del_dia', { p_centro_id: centroA.id, p_fecha: FECHA_MENU })
      expect(menu.error).toBeNull()
      expect((menu.data as { comida_primero: string }).comida_primero).toBe('Lentejas')

      const dia = await c.rpc('tipo_de_dia', { p_centro_id: centroA.id, p_fecha: FECHA_FESTIVO })
      expect(dia.data).toBe('festivo')

      const cerrado = await c.rpc('mes_cerrado', {
        p_centro_id: centroA.id,
        p_anio: 2026,
        p_mes: 6,
      })
      expect(cerrado.data).toBe(true)

      const imagen = await c.rpc('existe_consentimiento_imagen', { p_nino_id: ninoA })
      expect(imagen.data).toBe(true)

      const solida = await c.rpc('nino_toma_comida_solida', { p_nino_id: ninoA })
      expect(solida.data).toBe(false)
    }
  })

  it('curso_activo_de_centro y es_tutor_en_centro le contestan a B sobre A', async () => {
    for (const c of [cliDirectoraB, cliTutorB]) {
      const curso = await c.rpc('curso_activo_de_centro', { p_centro_id: centroA.id })
      expect(curso.data).toBe(aulaA.curso_academico_id)

      const esTutor = await c.rpc('es_tutor_en_centro', {
        p_tutor_id: tutorA.id,
        p_centro_id: centroA.id,
      })
      expect(esTutor.data).toBe(true)
    }
  })

  it('tiene_consentimiento le dice a B el consentimiento de una persona de A', async () => {
    const r = await cliTutorB.rpc('tiene_consentimiento', {
      p_usuario_id: tutorA.id,
      p_tipo: 'datos_medicos',
    })
    expect(r.data).toBe(true)
  })

  it('las 10 que no usa nadie con sesión se ejecutan con sesión, y algunas dan datos de A', async () => {
    const id = () => randomUUID()
    const llamadas: Array<[string, Record<string, unknown>]> = [
      ['centro_abierto', { p_centro_id: centroA.id, p_fecha: FECHA_FESTIVO }],
      ['centro_de_conversacion', { p_conversacion_id: id() }],
      ['centro_de_curso', { p_curso_id: aulaA.curso_academico_id }],
      ['centro_de_remesa', { p_remesa_id: id() }],
      ['familia_de_nino', { p_nino_id: ninoA }],
      ['nino_de_conversacion', { p_conversacion_id: id() }],
      ['nino_de_recibo', { p_recibo_id: id() }],
      ['publicacion_tiene_nino_sin_permiso', { p_publicacion_id: id() }],
      ['recibo_en_remesa', { p_recibo_id: id() }],
      ['tiene_consentimiento_imagen', { p_nino_id: ninoA }],
    ]
    expect(new Set(llamadas.map(([n]) => n)).size).toBe(10)
    for (const [nombre, args] of llamadas) {
      const { error } = await cliTutorB.rpc(nombre, args)
      expect(error, nombre).toBeNull()
    }
    expect((await cliTutorB.rpc('familia_de_nino', { p_nino_id: ninoA })).data).toBe(familiaA)
    expect(
      (await cliTutorB.rpc('centro_de_curso', { p_curso_id: aulaA.curso_academico_id })).data
    ).toBe(centroA.id)
    expect((await cliTutorB.rpc('tiene_consentimiento_imagen', { p_nino_id: ninoA })).data).toBe(
      true
    )
  })

  it('control: la profe de A ve la matrícula de su aula, y B la recorre sin error y no la ve', async () => {
    const cliProfeA = await clientFor(profeA)
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
