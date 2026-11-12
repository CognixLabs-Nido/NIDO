import { describe, expect, it } from 'vitest'

import { Analizador, type FuncionCatalogo } from './nulabilidad'

/**
 * Los controles del analizador de `nulabilidad.ts`: cada regla acepta su caso, y cada trampa (lo que
 * parece no nulo y no lo es, o no se puede demostrar) se rechaza. Si el analizador aceptara una
 * trampa, `tipos-overlay.rls.test.ts` daría por buena una columna que puede llegar NULL.
 *
 * Tablas de juguete: `t(id, nombre NOT NULL; nota admite NULL)`, `u(id NOT NULL, t_id admite NULL)`.
 */

const NO_NULAS = ['public.t.id', 'public.t.nombre', 'public.u.id']

function fn(nombre: string, cuerpo: string, columnas: string[], lenguaje = 'sql'): FuncionCatalogo {
  return { nombre: `public.${nombre}`, lenguaje, cuerpo, columnas }
}

function juzga(cuerpo: string, columna = 'x', extra: FuncionCatalogo[] = [], lenguaje = 'sql') {
  const an = new Analizador({
    funciones: [fn('f', cuerpo, ['x', 'y'], lenguaje), ...extra],
    noNulas: NO_NULAS,
  })
  return an.columna('public.f', columna)
}

describe('analizador de nulabilidad: lo que acepta', () => {
  it.each([
    ['columna NOT NULL por FROM', 'SELECT t.id, t.nota FROM public.t t'],
    ['con cast', 'SELECT t.nombre::text, 1 FROM public.t t'],
    ['por JOIN interior', 'SELECT u.id, 1 FROM public.t t JOIN public.u u ON u.t_id = t.id'],
    ['literal', "SELECT 'nino'::text, 1"],
    ['IS NOT NULL', 'SELECT t.nota IS NOT NULL, 1 FROM public.t t'],
    ['NOT EXISTS', 'SELECT NOT EXISTS (SELECT 1 FROM public.u), 1'],
    ['count', 'SELECT count(*)::integer, 1 FROM public.t'],
    ['subconsulta de count', 'SELECT (SELECT count(DISTINCT u.id)::integer FROM public.u u), 1'],
    ['coalesce con último no nulo', "SELECT coalesce(t.nota, '{}'), 1 FROM public.t t"],
    [
      'CASE con ELSE',
      "SELECT CASE WHEN t.nota IS NULL THEN 'a' WHEN true THEN t.id ELSE 'c' END, 1 FROM public.t t",
    ],
    [
      'filtro IS NOT NULL',
      'SELECT t.nota, 1 FROM public.t t WHERE t.id = $1 AND t.nota IS NOT NULL',
    ],
    ['por un CTE', 'WITH c AS (SELECT t.id AS clave FROM public.t t) SELECT c.clave, 1 FROM c'],
    [
      'UNION con las dos ramas',
      'SELECT t.id, 1 FROM public.t t UNION ALL SELECT u.id, 2 FROM public.u u ORDER BY 1',
    ],
    [
      'plpgsql con un RETURN QUERY',
      'BEGIN\n  -- comentario\n  RETURN QUERY SELECT t.id, 1 FROM public.t t;\nEND',
    ],
  ])('%s', (_, cuerpo) => {
    const lenguaje = cuerpo.startsWith('BEGIN') ? 'plpgsql' : 'sql'
    const v = juzga(cuerpo, 'x', [], lenguaje)
    expect(v, v.porque).toMatchObject({ ok: true })
  })

  it('a través de otra función, por LATERAL y por SELECT *', () => {
    const g = fn('g', 'SELECT t.id FROM public.t t', ['k'])
    expect(
      juzga('SELECT g.k, 1 FROM public.t t CROSS JOIN LATERAL public.g(t.id) g', 'x', [g])
    ).toMatchObject({ ok: true })
    const h = new Analizador({
      funciones: [fn('h', 'SELECT * FROM public.g() d', ['k']), g],
      noNulas: NO_NULAS,
    })
    expect(h.columna('public.h', 'k')).toMatchObject({ ok: true })
  })
})

describe('analizador de nulabilidad: lo que rechaza', () => {
  it.each([
    ['columna que admite NULL', 'SELECT t.nota, 1 FROM public.t t', 'admite NULL'],
    [
      'NOT NULL pero por LEFT JOIN',
      'SELECT u.id, 1 FROM public.t t LEFT JOIN public.u u ON u.t_id = t.id',
      'LEFT',
    ],
    [
      'LEFT JOIN LATERAL',
      'SELECT m.id, 1 FROM public.t t LEFT JOIN LATERAL (SELECT u.id FROM public.u u) m ON true',
      'LEFT',
    ],
    [
      'RIGHT JOIN deja todo anulable',
      'SELECT t.id, 1 FROM public.t t RIGHT JOIN public.u u ON u.t_id = t.id',
      'LEFT/RIGHT/FULL',
    ],
    ['CASE sin ELSE', "SELECT CASE WHEN true THEN 'a' END, 1", 'sin ELSE'],
    [
      'CASE con una rama NULL',
      "SELECT CASE WHEN true THEN 'a' ELSE t.nota END, 1 FROM public.t t",
      'rama',
    ],
    [
      'coalesce con último anulable',
      'SELECT coalesce(t.id, t.nota), 1 FROM public.t t',
      'coalesce',
    ],
    ['subconsulta escalar', 'SELECT (SELECT u.id FROM public.u u LIMIT 1), 1', 'subconsulta'],
    [
      'subconsulta de array_agg',
      'SELECT (SELECT array_agg(u.id) FROM public.u u), 1',
      'subconsulta',
    ],
    [
      'count con GROUP BY',
      'SELECT (SELECT count(*) FROM public.u u GROUP BY u.t_id), 1',
      'subconsulta',
    ],
    ['una variable', 'SELECT v_centro, 1', 'fuera de las reglas'],
    ['AND', 'SELECT t.nota IS NOT NULL AND t.nota > 1, 1 FROM public.t t', 'fuera de las reglas'],
    ['una comparación', "SELECT t.nombre = 'x', 1 FROM public.t t", 'fuera de las reglas'],
    ['concat_ws', "SELECT concat_ws(' ', t.nombre), 1 FROM public.t t", 'fuera de las reglas'],
    [
      'filtro sobre otra expresión',
      'SELECT t.nota, 1 FROM public.t t WHERE t.nombre IS NOT NULL',
      'admite NULL',
    ],
    [
      'filtro dentro de un OR',
      'SELECT t.nota, 1 FROM public.t t WHERE t.nota IS NOT NULL OR t.id = $1',
      'admite NULL',
    ],
    [
      'UNION con una rama mala',
      'SELECT t.id, 1 FROM public.t t UNION ALL SELECT t.nota, 2 FROM public.t t',
      'rama 2',
    ],
    [
      'CTE que acaba en una anulable',
      'WITH c AS (SELECT t.nota AS clave FROM public.t t) SELECT c.clave, 1 FROM c',
      'admite NULL',
    ],
  ])('%s', (_, cuerpo, motivo) => {
    const v = juzga(cuerpo)
    expect(v.ok).toBe(false)
    expect(v.porque).toContain(motivo)
  })

  it('plpgsql con RETURN NEXT (o sin un único RETURN QUERY)', () => {
    const v = juzga('BEGIN\n  x := 1;\n  RETURN NEXT;\nEND', 'x', [], 'plpgsql')
    expect(v).toMatchObject({ ok: false })
    expect(v.porque).toContain('RETURN QUERY')
  })

  it('una función o una columna que no existen', () => {
    expect(juzga('SELECT t.id, 1 FROM public.t t', 'zz')).toMatchObject({ ok: false })
    const an = new Analizador({ funciones: [], noNulas: NO_NULAS })
    expect(an.columna('public.nada', 'x')).toMatchObject({ ok: false })
  })
})
