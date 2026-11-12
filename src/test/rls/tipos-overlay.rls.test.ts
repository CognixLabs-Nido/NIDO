import { execFileSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import { COLUMNAS_GENERADAS, FUNCIONES_RETURNS_TABLE, NO_DEMOSTRABLES, NO_NULAS } from '@/types/db'

import { Analizador, type Catalogo } from '../tipos/nulabilidad'

/**
 * `src/types/db.ts` añade al generado lo que el generador no sabe, y lo hace con LISTAS: las
 * funciones `RETURNS TABLE` (cuyas columnas pasan a `| null`) y las columnas generadas (que pasan a
 * `?: never`). Una lista se queda atrás en silencio: una función nueva fuera de la lista vuelve a
 * tener sus columnas «no nulas», sin que nada se ponga rojo. Aquí se comparan con el catálogo de la
 * base efímera, que es la lectura independiente.
 *
 * Y las columnas que la capa declara NO nulas (`NO_NULAS`) se demuestran aquí contra la base: el cuerpo
 * de cada función y `attnotnull` de cada columna de origen, con las reglas de `nulabilidad.ts`. Las de
 * `NO_DEMOSTRABLES` tienen que seguir sin demostrarse: son, además, los controles del analizador sobre
 * cuerpos reales.
 *
 * Lo que vale para cada entrada (que el tipo de `ficha_gestion_ninos.dni` admite null, que
 * `ninos.apellidos` no se escribe) lo prueba `src/test/tipos/overlay.test.ts`, en tipos.
 */

const CATALOGO = `
SELECT json_build_object(
  'funciones', (SELECT json_agg(json_build_object(
      'nombre', n.nspname || '.' || p.proname, 'lenguaje', l.lanname, 'cuerpo', p.prosrc,
      'columnas', (SELECT json_agg(a.n ORDER BY a.i)
                     FROM unnest(p.proargnames, p.proargmodes::text[]) WITH ORDINALITY a(n, m, i)
                    WHERE a.m = 't')))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
   WHERE n.nspname IN ('public', 'privado') AND p.prokind = 'f' AND 't' = ANY (p.proargmodes::text[])),
  'noNulas', (SELECT json_agg(n.nspname || '.' || c.relname || '.' || a.attname)
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('public', 'auth', 'storage') AND c.relkind IN ('r', 'p')
     AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull));`

function pares(o: Record<string, readonly string[] | Record<string, string>>): [string, string][] {
  return Object.entries(o).flatMap(([f, cols]) =>
    (Array.isArray(cols) ? cols : Object.keys(cols)).map((c): [string, string] => [f, c])
  )
}

function psql(sql: string): string {
  const url = process.env.DB_URL
  if (!url) throw new Error('DB_URL: este test solo corre contra la BD efímera del CI')
  return execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
  })
}

function lista(sql: string): string[] {
  return psql(sql)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .sort() // en JS, como la lista: el ORDER BY de la base va con su collation
}

describe('la capa de tipos sobre el generado cubre el catálogo entero', () => {
  it('FUNCIONES_RETURNS_TABLE son exactamente las RETURNS TABLE de public', () => {
    const catalogo = lista(`
      SELECT DISTINCT p.proname
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proretset
         AND 't' = ANY (p.proargmodes::text[])
       ORDER BY 1;`)
    // Premisa: el predicado coge algo, y coge la del caso medido (dni NULL en producción).
    expect(catalogo.length).toBeGreaterThan(30)
    expect(catalogo).toContain('ficha_gestion_ninos')
    expect([...FUNCIONES_RETURNS_TABLE].sort()).toEqual(catalogo)
  })

  it('COLUMNAS_GENERADAS son exactamente las columnas generadas de public', () => {
    const catalogo = lista(`
      SELECT c.relname || '.' || a.attname
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
         AND a.attgenerated <> ''
       ORDER BY 1;`)
    expect(catalogo.length).toBeGreaterThan(0)
    expect([...COLUMNAS_GENERADAS].sort()).toEqual(catalogo)
  })

  describe('NO_NULAS se demuestra contra la base', () => {
    const cat = (): Catalogo => {
      const linea = psql(CATALOGO)
        .split('\n')
        .find((l) => l.startsWith('{'))
      if (!linea) throw new Error('tipos-overlay: el catálogo no ha salido')
      return JSON.parse(linea) as Catalogo
    }
    let an: Analizador
    const declaradas = pares(NO_NULAS)
    const apartadas = pares(NO_DEMOSTRABLES)

    it('premisa: el catálogo trae las funciones y las columnas NOT NULL, y hay algo que demostrar', () => {
      const c = cat()
      expect(c.funciones.length).toBeGreaterThan(30)
      expect(c.noNulas).toContain('public.ninos.id')
      expect(c.noNulas).not.toContain('public.ninos.dni')
      expect(declaradas.length).toBeGreaterThan(100)
      an = new Analizador(c)
    })

    it.each(declaradas)('%s.%s no puede ser NULL', (f, col) => {
      const v = an.columna(`public.${f}`, col)
      expect(v, v.porque).toMatchObject({ ok: true })
    })

    it.each(apartadas)('%s.%s sigue sin poder demostrarse (y no está en NO_NULAS)', (f, col) => {
      expect(declaradas).not.toContainEqual([f, col])
      const v = an.columna(`public.${f}`, col)
      expect(v, v.porque).toMatchObject({ ok: false })
    })
  })
})
