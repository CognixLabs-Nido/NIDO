import { execFileSync } from 'node:child_process'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestAula,
  type TestCentro,
  type TestCurso,
  type TestNino,
  type TestUser,
} from './setup'

/**
 * Una fila y lo que nombra son del mismo centro (`zz_centro_coherente`, 20270108120000).
 *
 * 1. **La cobertura, del catálogo:** cada par de `privado.centro_coherente_pares()` y cada pareja de
 *    `privado.centro_coherente_cruces()` tiene su comprobación en el trigger de su tabla, o su
 *    excepción con motivo; la única FK compuesta hacia una tabla con centro es la de `matriculas`, y
 *    tiene la suya a mano. Una FK nueva entre tablas con centro (o una compuesta) sin su
 *    comprobación pone esto rojo: la migración la generó una vez, no se genera sola.
 * 2. **El comportamiento**, con dos centros, en tablas de cada forma: un par de la primera clase
 *    (por INSERT, por UPDATE de la columna y por UPDATE del centro), NULL que pasa, el centro que
 *    pone `*_set_centro_id` antes, una tabla de cruce, `matriculas` y `profes_aulas`. Con el
 *    servicio, que se salta la RLS: lo que para es el trigger.
 *
 * Por psql como `postgres` contra la BD efímera del CI (`DB_URL`) lo que no tiene privilegios o va
 * en una transacción que se deshace.
 */

type CitaInsert = Database['public']['Tables']['citas']['Insert']

function psql(sql: string): string {
  const url = process.env.DB_URL
  if (!url) throw new Error('DB_URL: este test solo corre contra la BD efímera del CI')
  return execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
  })
}

function lineaJson<T>(salida: string): T {
  const linea = salida.split('\n').find((l) => l.startsWith('{'))
  if (linea === undefined) throw new Error(`centro-coherente: sin JSON: ${salida}`)
  return JSON.parse(linea) as T
}

interface Cobertura {
  pares: number
  tablas: number
  pares_sin: string[]
  cruces: number
  cruces_sin: string[]
  compuestas: string[]
  matriculas: boolean
  triggers: number
  ejecutables: string[]
  excepciones: number
}

const COBERTURA = `
WITH cr AS (
  SELECT a.tabla, a.columna AS c1, b.columna AS c2
    FROM privado.centro_coherente_cruces() a
    JOIN privado.centro_coherente_cruces() b ON b.tabla = a.tabla AND a.columna < b.columna
), zz AS (
  SELECT tg.tgrelid, pg_get_triggerdef(tg.oid) AS def, f.prosrc, f.proname
    FROM pg_trigger tg JOIN pg_proc f ON f.oid = tg.tgfoid
   WHERE tg.tgname = 'zz_centro_coherente' AND tg.tgenabled = 'O' AND f.prosecdef
)
SELECT json_build_object(
  'pares', (SELECT count(*) FROM privado.centro_coherente_pares()),
  'tablas', (SELECT count(DISTINCT tabla) FROM privado.centro_coherente_pares()),
  'pares_sin', (SELECT coalesce(json_agg(p.tabla || '.' || p.columna ORDER BY 1), '[]')
    FROM privado.centro_coherente_pares() p
   WHERE NOT EXISTS (SELECT 1 FROM privado.centro_coherente_excepciones e WHERE e.tabla = p.tabla AND e.columna = p.columna)
     AND NOT EXISTS (SELECT 1 FROM zz WHERE zz.tgrelid = p.tabla::regclass
                       AND zz.def ~ ('UPDATE OF centro_id, .*\\m' || p.columna || '\\M')
                       AND zz.prosrc LIKE '%NEW.' || p.columna || ' IS NOT NULL AND EXISTS%')),
  'cruces', (SELECT count(*) FROM cr),
  'cruces_sin', (SELECT coalesce(json_agg(cr.tabla || ' ' || cr.c1 || '+' || cr.c2 ORDER BY 1), '[]') FROM cr
   WHERE NOT EXISTS (SELECT 1 FROM privado.centro_coherente_excepciones e WHERE e.tabla = cr.tabla AND e.columna IN (cr.c1, cr.c2))
     AND NOT EXISTS (SELECT 1 FROM zz WHERE zz.tgrelid = cr.tabla::regclass
                       AND zz.def ~ ('UPDATE OF .*\\m' || cr.c1 || '\\M') AND zz.def ~ ('UPDATE OF .*\\m' || cr.c2 || '\\M')
                       AND zz.prosrc LIKE '%NEW.' || cr.c1 || ' IS NOT NULL AND NEW.' || cr.c2 || ' IS NOT NULL AND EXISTS%')),
  'compuestas', (SELECT coalesce(json_agg(c.conname::text ORDER BY 1), '[]') FROM pg_constraint c
   WHERE c.contype = 'f' AND cardinality(c.conkey) > 1 AND c.connamespace = 'public'::regnamespace
     AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.confrelid AND x.attname = 'centro_id' AND NOT x.attisdropped)),
  'matriculas', EXISTS (SELECT 1 FROM zz WHERE zz.tgrelid = 'public.matriculas'::regclass
                         AND zz.proname = 'matriculas_centro_coherente'),
  'triggers', (SELECT count(*) FROM pg_trigger WHERE tgname = 'zz_centro_coherente'),
  'ejecutables', (SELECT coalesce(json_agg(f.proname::text ORDER BY 1), '[]') FROM pg_proc f
   WHERE f.pronamespace = 'privado'::regnamespace AND f.proname LIKE '%\\_centro\\_coherente%'
     AND (has_function_privilege('authenticated', f.oid, 'EXECUTE') OR has_function_privilege('anon', f.oid, 'EXECUTE')
          OR has_function_privilege('service_role', f.oid, 'EXECUTE'))),
  'excepciones', (SELECT count(*) FROM privado.centro_coherente_excepciones)
);`

describe('zz_centro_coherente: la cobertura, del catálogo', () => {
  let c: Cobertura
  beforeAll(() => {
    c = lineaJson<Cobertura>(psql(COBERTURA))
  })

  it('premisa: el catálogo ve pares y parejas (si no ve nada, todo lo de abajo pasaría en vacío)', () => {
    expect(c.pares).toBeGreaterThan(0)
    expect(c.cruces).toBeGreaterThan(0)
  })

  it('cada par de la primera clase tiene su comprobación (o su excepción con motivo)', () => {
    expect(c.pares_sin).toEqual([])
  })

  it('cada pareja de una tabla de cruce tiene su comprobación', () => {
    expect(c.cruces_sin).toEqual([])
  })

  it('el límite del método: la única FK compuesta hacia una tabla con centro es la de matriculas, cubierta a mano', () => {
    expect(c.compuestas).toEqual(['matriculas_aula_curso_fkey'])
    expect(c.matriculas).toBe(true)
  })

  it('un trigger por tabla, y sus funciones no las ejecuta nadie con sesión ni el servicio', () => {
    const cruces = lineaJson<{ n: number }>(
      psql(
        `SELECT json_build_object('n', (SELECT count(DISTINCT tabla) FROM privado.centro_coherente_cruces()));`
      )
    ).n
    expect(c.triggers).toBe(c.tablas + cruces + 1)
    expect(c.ejecutables).toEqual([])
  })

  it('hoy no hay excepciones (una nueva, con su motivo, cambia este número a propósito)', () => {
    expect(c.excepciones).toBe(0)
  })
})

describe('zz_centro_coherente: el comportamiento, con dos centros', () => {
  let A: TestCentro
  let B: TestCentro
  let cursoA: TestCurso
  let cursoB: TestCurso
  let aulaA: TestAula
  let aulaB: TestAula
  let ninoA: TestNino
  let ninoB: TestNino
  let user: TestUser
  let eventoA: string
  const citas: string[] = []
  const matriculas: string[] = []
  const profesAulas: string[] = []
  const confirmaciones: string[] = []

  beforeAll(async () => {
    A = await createTestCentro('Centro coherente A')
    B = await createTestCentro('Centro coherente B')
    cursoA = await createTestCurso(A.id)
    cursoB = await createTestCurso(B.id)
    aulaA = await createTestAula(A.id, cursoA.id)
    aulaB = await createTestAula(B.id, cursoB.id)
    ninoA = await createTestNino(A.id)
    ninoB = await createTestNino(B.id)
    user = await createTestUser({ nombre: 'Centro coherente' })
    const { data, error } = await serviceClient
      .from('eventos')
      .insert({
        centro_id: A.id,
        ambito: 'centro',
        tipo: 'otro',
        titulo: 'Evento coherente',
        fecha: '2027-01-15',
        creado_por: user.id,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`evento: ${error?.message}`)
    eventoA = data.id
  })

  afterAll(async () => {
    for (const id of confirmaciones)
      await serviceClient.from('confirmaciones_evento').delete().eq('id', id)
    await serviceClient.from('eventos').delete().eq('id', eventoA)
    for (const id of citas) await serviceClient.from('citas').delete().eq('id', id)
    for (const id of matriculas) await serviceClient.from('matriculas').delete().eq('id', id)
    for (const id of profesAulas) await serviceClient.from('profes_aulas').delete().eq('id', id)
    await deleteTestCentro(A.id)
    await deleteTestCentro(B.id)
    await deleteTestUser(user.id)
  })

  const cita = (nino: string | null, centro: string = A.id): CitaInsert => ({
    centro_id: centro,
    tipo: nino === null ? 'reunion_claustro' : 'reunion_familia',
    organizador_id: user.id,
    titulo: 'Reunión',
    fecha: '2027-01-15',
    hora_inicio: '10:00',
    nino_id: nino,
  })

  it('premisa: los fixtures son de los centros que el test dice', () => {
    expect([ninoA.centro_id, aulaA.centro_id, cursoA.centro_id]).toEqual([A.id, A.id, A.id])
    expect([ninoB.centro_id, aulaB.centro_id, cursoB.centro_id]).toEqual([B.id, B.id, B.id])
    expect(A.id).not.toBe(B.id)
  })

  it('primera clase, INSERT: una cita de A con el niño de B no entra; con el de A, sí', async () => {
    const mal = await serviceClient.from('citas').insert(cita(ninoB.id)).select('id')
    expect(mal.error?.code).toBe('23514')
    expect(mal.error?.hint).toBe('centro_ajeno')
    expect(mal.error?.message).toContain('public.citas.nino_id')
    const bien = await serviceClient.from('citas').insert(cita(ninoA.id)).select('id').single()
    expect(bien.error).toBeNull()
    citas.push(bien.data!.id)
  })

  it('primera clase, UPDATE de la columna y UPDATE del centro: tampoco, y la fila sigue como estaba', async () => {
    const id = citas[0]
    expect(id).toBeTruthy()
    const nino = await serviceClient.from('citas').update({ nino_id: ninoB.id }).eq('id', id)
    expect(nino.error?.code).toBe('23514')
    expect(nino.error?.hint).toBe('centro_ajeno')
    const centro = await serviceClient.from('citas').update({ centro_id: B.id }).eq('id', id)
    expect(centro.error?.code).toBe('23514')
    expect(centro.error?.hint).toBe('centro_ajeno')
    const { data } = await serviceClient
      .from('citas')
      .select('centro_id, nino_id')
      .eq('id', id)
      .single()
    expect(data).toEqual({ centro_id: A.id, nino_id: ninoA.id })
  })

  it('primera clase, NULL: lo que no nombra nada no se mira', async () => {
    const r = await serviceClient.from('citas').insert(cita(null)).select('id').single()
    expect(r.error).toBeNull()
    citas.push(r.data!.id)
  })

  it('lo que no existe lo dice la FK (23503), no el trigger: una cita con un niño que no existe', async () => {
    const r = await serviceClient.from('citas').insert(cita('00000000-0000-4000-8000-000000000000'))
    expect(r.error?.code).toBe('23503')
    expect(r.error?.hint ?? null).not.toBe('centro_ajeno')
  })

  it('el orden: con el centro NULL, `*_set_centro_id` lo pone antes y zz_ encuentra la fila coherente', () => {
    const salida = psql(`BEGIN;
      INSERT INTO public.recordatorios (centro_id, titulo, destinatario, nino_id, creado_por)
        VALUES (NULL, 'Coherente', 'familia_individual', '${ninoB.id}', '${user.id}')
        RETURNING json_build_object('centro', centro_id);
      ROLLBACK;`)
    expect(lineaJson<{ centro: string }>(salida).centro).toBe(B.id)
  })

  it('tabla de cruce: una confirmación del evento de A con el niño de B no entra; con el de A, sí', async () => {
    const fila = (nino: string) => ({
      evento_id: eventoA,
      nino_id: nino,
      estado: 'confirmado' as const,
      confirmado_por: user.id,
    })
    const mal = await serviceClient.from('confirmaciones_evento').insert(fila(ninoB.id))
    expect(mal.error?.code).toBe('23514')
    expect(mal.error?.hint).toBe('centro_ajeno')
    expect(mal.error?.message).toContain('public.confirmaciones_evento: evento_id y nino_id')
    const bien = await serviceClient
      .from('confirmaciones_evento')
      .insert(fila(ninoA.id))
      .select('id')
      .single()
    expect(bien.error).toBeNull()
    confirmaciones.push(bien.data!.id)
  })

  it('matriculas (a mano, FK compuesta): el niño de A no entra en el aula-curso de B; en el suyo, sí', async () => {
    const fila = (aula: string, curso: string) => ({
      nino_id: ninoA.id,
      aula_id: aula,
      curso_academico_id: curso,
    })
    const mal = await serviceClient.from('matriculas').insert(fila(aulaB.id, cursoB.id))
    expect(mal.error?.code).toBe('23514')
    expect(mal.error?.hint).toBe('centro_ajeno')
    expect(mal.error?.message).toContain('public.matriculas')
    const bien = await serviceClient
      .from('matriculas')
      .insert(fila(aulaA.id, cursoA.id))
      .select('id')
      .single()
    expect(bien.error).toBeNull()
    matriculas.push(bien.data!.id)
    // Y por UPDATE: la misma matrícula, al aula-curso de B.
    const movida = await serviceClient
      .from('matriculas')
      .update({ aula_id: aulaB.id, curso_academico_id: cursoB.id })
      .eq('id', bien.data!.id)
    expect(movida.error?.code).toBe('23514')
  })

  it('profes_aulas: el aula de A con el curso de B no entra; con el suyo, sí', async () => {
    const fila = (curso: string) => ({
      profe_id: user.id,
      aula_id: aulaA.id,
      curso_academico_id: curso,
    })
    const mal = await serviceClient.from('profes_aulas').insert(fila(cursoB.id))
    expect(mal.error?.code).toBe('23514')
    expect(mal.error?.hint).toBe('centro_ajeno')
    expect(mal.error?.message).toContain('public.profes_aulas: aula_id y curso_academico_id')
    const bien = await serviceClient
      .from('profes_aulas')
      .insert(fila(cursoA.id))
      .select('id')
      .single()
    expect(bien.error).toBeNull()
    profesAulas.push(bien.data!.id)
  })
})
