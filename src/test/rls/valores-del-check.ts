import { consultaBase } from './columnas-vivas'

/**
 * Los valores que la BASE admite en una columna con un CHECK de lista (`col IN (…)` o `col <@ ARRAY[…]`),
 * leídos del catálogo de la base del CI y no del texto de una migración (decisión del 2026-11-19, la
 * 10c). Leído de los ficheros, el test de los textos del registro de lecturas miraba solo la migración
 * que creó la tabla, y `datos_bloqueados` (20261211120000) entró sin texto en ningún idioma con el
 * test en verde. Buscar la «última migración que lo escribe» habría sido otra lista: un CHECK escrito
 * de otra forma, o con otro nombre, se escaparía igual. Al catálogo no se le escapa ninguno.
 *
 * Una fila por (columna, CHECK): `columna|definición`. Suelto para que el control negativo lo corra
 * dentro de su transacción.
 */
export function sqlChecksDeColumnas(tabla: string, columnas: readonly string[]): string {
  const lista = columnas.map((c) => `'${c.replace(/'/g, "''")}'`).join(', ')
  return `SELECT a.attname || '|' || pg_get_constraintdef(k.oid)
  FROM pg_constraint k
  JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
 WHERE k.conrelid = '${tabla.replace(/'/g, "''")}'::regclass AND k.contype = 'c' AND a.attname IN (${lista})
 ORDER BY 1;`
}

/** Lee la salida: columna → sus CHECK, y de cada uno los literales de texto que nombra. */
export function leerChecks(salida: string): Map<string, string[][]> {
  const m = new Map<string, string[][]>()
  for (const linea of salida.split('\n').filter(Boolean)) {
    const i = linea.indexOf('|')
    const col = linea.slice(0, i)
    const valores = [...linea.slice(i + 1).matchAll(/'([^']+)'::text/g)].map((x) => x[1]!).sort()
    m.set(col, [...(m.get(col) ?? []), valores])
  }
  return m
}

/** Los valores admitidos en cada columna, en la base del CI (solo local: `consultaBase`). */
export function checksDeColumnas(tabla: string, columnas: readonly string[]) {
  return leerChecks(consultaBase(sqlChecksDeColumnas(tabla, columnas)))
}

/** Los valores de `valores` sin texto (vacío o ausente) en `ns[grupo]`. */
export function sinTexto(
  ns: Record<string, Record<string, string> | undefined>,
  grupo: string,
  valores: readonly string[]
): string[] {
  return valores.filter((v) => !ns[grupo]?.[v]?.trim())
}
