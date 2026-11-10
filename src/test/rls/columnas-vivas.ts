import { execFileSync } from 'node:child_process'

import { expect } from 'vitest'

/**
 * Las columnas VIVAS de la base del CI, para las listas cerradas de los tests: una lista escrita a
 * mano que afirma «todas las columnas personales de esta tabla» se queda corta con la primera
 * columna nueva, y se queda corta EN VERDE. Comparada con el catálogo, la columna nueva salta
 * hasta que alguien decide si es personal o no.
 *
 * El mecanismo es el de la red del export (`export-columnas.rls.test.ts`), movido aquí para que
 * lo compartan: la descripción OpenAPI de PostgREST con la clave de servicio, sin leer ninguna
 * fila; y para la tabla que el servicio no lee, el catálogo de la base por psql.
 */

export async function columnasVivas(): Promise<Record<string, string[]>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const res = await fetch(`${url}/rest/v1/`, {
    headers: {
      apikey: clave,
      Authorization: `Bearer ${clave}`,
      Accept: 'application/openapi+json',
    },
  })
  expect(res.status).toBe(200)
  const spec = (await res.json()) as {
    definitions: Record<string, { properties: Record<string, unknown> }>
  }
  return Object.fromEntries(
    Object.entries(spec.definitions).map(([t, d]) => [t, Object.keys(d.properties).sort()])
  )
}

/** Una consulta de solo lectura contra la BD efímera del CI, por psql. Devuelve la salida cruda. */
export function consultaBase(sql: string): string {
  const url = process.env.DB_URL
  if (!url) throw new Error('DB_URL: este test solo corre contra la BD efímera del CI')
  return execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
  }).trim()
}

/**
 * Una tabla sin privilegios para `service_role` no sale en la descripción de la API con la clave de
 * servicio (desde el 3b, `firmas_documentos_centro`: la sesión la lee y el servidor no). Sus columnas
 * vivas salen del catálogo de la base, por psql contra la BD del CI, y solo si ese es el motivo.
 */
export function columnasDeLaBase(tabla: string): { servicioLee: boolean; columnas: string[] } {
  const salida = consultaBase(
    `SELECT has_table_privilege('service_role', 'public.${tabla}', 'SELECT')::text || '|' ||
      coalesce((SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = '${tabla}'), '');`
  )
  const [lee, cols] = salida.split('|')
  return { servicioLee: lee === 'true', columnas: cols ? cols.split(',') : [] }
}

/**
 * Comprueba que cada columna viva de `tabla` está DECIDIDA: o en `lista` (la que el test afirma
 * completa: las que se purgan, las que no se auditan…), o en `excluidas` con su porqué escrito. Y
 * que ninguna de las dos nombra una columna que ya no existe.
 *
 * Autocomprobación, para que el verde no sea por vacío: la tabla tiene columnas vivas y entre
 * ellas está `conocida`.
 */
export async function expectColumnasDecididas(
  tabla: string,
  lista: readonly string[],
  excluidas: Readonly<Record<string, string>>,
  conocida: string
): Promise<void> {
  let vivas = (await columnasVivas())[tabla]
  if (!vivas) {
    const b = columnasDeLaBase(tabla)
    expect(b.servicioLee, `${tabla} falta en la API y el servicio sí la lee`).toBe(false)
    vivas = b.columnas
  }
  expect(vivas.length, `${tabla}: sin columnas vivas`).toBeGreaterThan(0)
  expect(vivas, `${tabla}: la columna conocida`).toContain(conocida)

  const fuera = Object.keys(excluidas)
  expect(
    lista.filter((c) => fuera.includes(c)),
    `${tabla}: columnas en la lista y en las excluidas a la vez`
  ).toEqual([])
  for (const [c, porque] of Object.entries(excluidas)) {
    expect(porque.trim().length, `${tabla}.${c}: la exclusión no dice por qué`).toBeGreaterThan(10)
  }
  const decididas = new Set([...lista, ...fuera])
  expect(
    vivas.filter((c) => !decididas.has(c)),
    `${tabla}: columnas sin decidir (añádelas a la lista o a las excluidas, con su porqué)`
  ).toEqual([])
  expect(
    [...decididas].filter((c) => !vivas!.includes(c)).sort(),
    `${tabla}: columnas decididas que ya no existen`
  ).toEqual([])
}
