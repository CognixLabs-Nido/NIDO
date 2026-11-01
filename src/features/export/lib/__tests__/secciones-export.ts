import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Lee `export_datos_sujeto` de la última migración que lo define y saca, de cada sección, la tabla
 * de sus filas y qué columna de esa tabla sale con qué clave. Solo cuenta lo que va dentro del
 * `jsonb_build_object` de la fila (no lo de WHERE ni ORDER BY), y solo las columnas de la tabla de
 * la sección (no las de una tabla que se consulta para un nombre, como el curso).
 */

const MIGRACIONES = join(process.cwd(), 'supabase', 'migrations')
const DEFINE = 'CREATE OR REPLACE FUNCTION public.export_datos_sujeto('

export interface SeccionLeida {
  tabla: string
  /** columna → clave con la que sale */
  salen: Record<string, string>
  /**
   * clave → condición del JOIN, de cada nombre de otra persona que sale de un JOIN a
   * `public.usuarios` (no son columnas de la tabla de la sección: `NOMBRES_DE_OTROS`).
   */
  nombres: Record<string, string>
}

/** Cuántos JOIN a `public.usuarios` lleva el cuerpo: cada uno tiene que dar un nombre leído. */
export function joinsAUsuarios(cuerpo = cuerpoDelExport()): number {
  return (cuerpo.match(/JOIN public\.usuarios \w+ ON/g) ?? []).length
}

export function ultimaMigracionDelExport(): string {
  const fichero = readdirSync(MIGRACIONES)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => readFileSync(join(MIGRACIONES, f), 'utf8').includes(DEFINE))
    .at(-1)
  if (!fichero) throw new Error('ninguna migración define export_datos_sujeto')
  return fichero
}

/** El cuerpo de la función, sin comentarios. */
export function cuerpoDelExport(fichero = ultimaMigracionDelExport()): string {
  const sql = readFileSync(join(MIGRACIONES, fichero), 'utf8')
  const desde = sql.lastIndexOf(DEFINE)
  const ini = sql.indexOf('$function$', desde) + '$function$'.length
  const fin = sql.indexOf('$function$', ini)
  return sql.slice(ini, fin).replace(/--[^\n]*/g, '')
}

function cierre(s: string, abre: number): number {
  let nivel = 0
  let enComillas = false
  for (let i = abre; i < s.length; i++) {
    const c = s[i]
    if (c === "'") enComillas = !enComillas
    if (enComillas) continue
    if (c === '(') nivel++
    else if (c === ')' && --nivel === 0) return i
  }
  throw new Error('paréntesis sin cerrar')
}

function argumentos(s: string): string[] {
  const out: string[] = []
  let nivel = 0
  let enComillas = false
  let actual = ''
  for (const c of s) {
    if (c === "'") enComillas = !enComillas
    if (!enComillas) {
      if (c === '(') nivel++
      else if (c === ')') nivel--
      else if (c === ',' && nivel === 0) {
        out.push(actual.trim())
        actual = ''
        continue
      }
    }
    actual += c
  }
  out.push(actual.trim())
  return out
}

const AGG = /jsonb_agg\(\s*jsonb_build_object\(/

function leerSeccion(txt: string, ruta: string, out: Record<string, SeccionLeida>) {
  const m = AGG.exec(txt)!
  const abreAgg = txt.indexOf('(', m.index)
  const cierraAgg = cierre(txt, abreAgg)
  const abreObj = txt.indexOf('(', m.index + 'jsonb_agg('.length)
  const cierraObj = cierre(txt, abreObj)
  const from = /^\s*FROM public\.(\w+) (\w+)/.exec(txt.slice(cierraAgg + 1))
  if (!from) throw new Error(`${ruta}: sin FROM tras el jsonb_agg`)
  const [, tabla, alias] = from
  const salen: Record<string, string> = {}
  const nombres: Record<string, string> = {}
  // Lo de detrás del jsonb_agg es el FROM de esta fila (las anidadas van dentro del objeto).
  const joins = [
    ...txt
      .slice(cierraAgg + 1)
      .matchAll(/JOIN public\.usuarios (\w+) ON ([\s\S]*?)(?=\bJOIN\b|\bWHERE\b|$)/g),
  ].map(([, a, on]) => ({ a, on: on.replace(/\s+/g, ' ').trim() }))
  const pares = argumentos(txt.slice(abreObj + 1, cierraObj))
  for (let i = 0; i < pares.length; i += 2) {
    const clave = pares[i].replace(/^'|'$/g, '')
    const expr = pares[i + 1]
    if (AGG.test(expr)) {
      leerSeccion(expr, `${ruta}.${clave}`, out)
      continue
    }
    for (const [, col] of expr.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`, 'g'))) {
      salen[col] ??= clave
    }
    for (const j of joins)
      if (new RegExp(`\\b${j.a}\\.nombre_completo\\b`).test(expr)) nombres[clave] = j.on
  }
  out[ruta] = { tabla, salen, nombres }
}

export function seccionesDelExport(cuerpo = cuerpoDelExport()): Record<string, SeccionLeida> {
  const out: Record<string, SeccionLeida> = {}
  for (const sujeto of ['usuario', 'nino']) {
    const si = cuerpo.indexOf(`IF p_sujeto_tipo = '${sujeto}' THEN`)
    const ret = cuerpo.indexOf('RETURN jsonb_build_object(', si)
    const abre = cuerpo.indexOf('(', ret)
    const pares = argumentos(cuerpo.slice(abre + 1, cierre(cuerpo, abre)))
    for (let i = 0; i < pares.length; i += 2) {
      if (AGG.test(pares[i + 1]))
        leerSeccion(pares[i + 1], `${sujeto}.${pares[i].replace(/'/g, '')}`, out)
    }
  }
  return out
}
