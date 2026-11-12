/**
 * ¿Puede una columna de una función `RETURNS TABLE` salir NULL? Postgres no lo guarda, así que se mira
 * el cuerpo, tal como lo tiene la base, y se acepta «no nula» SOLO por una de estas reglas:
 *
 *   - `alias.columna` de una tabla que el catálogo dice NOT NULL, con el alias atado por FROM o por un
 *     JOIN interior (nunca LEFT, RIGHT ni FULL). Si el alias es un CTE, una subconsulta o una función,
 *     se sigue hasta su origen, en todas las ramas de un UNION;
 *   - un literal (`'texto'`, un número, `true`/`false`);
 *   - `x IS NULL` / `x IS NOT NULL`, `EXISTS (…)` / `NOT EXISTS (…)`;
 *   - `count(…)`, o una subconsulta escalar cuyo único valor es un `count(…)` sin GROUP BY;
 *   - `coalesce(…, y)` con `y` no nula por estas reglas;
 *   - `CASE … END` con ELSE, y todas sus ramas no nulas por estas reglas;
 *   - un filtro `x IS NOT NULL` en el WHERE de esa misma consulta, sobre la misma expresión.
 *
 * Todo lo demás (una variable de plpgsql, una subconsulta que puede no dar fila, `concat_ws`, una
 * comparación, `AND`…) se rechaza, aunque parezca imposible que dé NULL: el rechazo deja la columna
 * `| null`, que es lo seguro. Los casts del final (`::text`) se quitan antes de mirar.
 *
 * Es un lector pequeño de SQL, no un parser: lo que no entiende, lo rechaza. Sus controles, en
 * `nulabilidad.test.ts`; su uso contra la base, en `tipos-overlay.rls.test.ts`.
 */

export interface FuncionCatalogo {
  /** `esquema.nombre` */
  nombre: string
  lenguaje: string
  cuerpo: string
  /** Las columnas del `RETURNS TABLE`, en orden. */
  columnas: string[]
}

export interface Catalogo {
  funciones: FuncionCatalogo[]
  /** `esquema.tabla.columna` de cada columna NOT NULL. */
  noNulas: string[]
}

export type Veredicto = { ok: true; porque: string } | { ok: false; porque: string }

const si = (porque: string): Veredicto => ({ ok: true, porque })
const no = (porque: string): Veredicto => ({ ok: false, porque })

// ─── Lectura del texto ─────────────────────────────────────────────────────────────────────────

/** Sin comentarios `--`, en minúsculas y con los espacios colapsados. Los literales no importan. */
export function normalizar(sql: string): string {
  let out = ''
  let enCadena = false
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!
    if (enCadena) {
      out += c
      if (c === "'") enCadena = false
      continue
    }
    if (c === "'") {
      enCadena = true
      out += c
      continue
    }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      out += ' '
      continue
    }
    out += c
  }
  return out.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** `nivel[i]`: profundidad de paréntesis en `i`, o -1 si `i` está dentro de una cadena. */
function niveles(s: string): number[] {
  const r: number[] = []
  let d = 0
  let enCadena = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (enCadena) {
      r.push(-1)
      if (c === "'") enCadena = false
      continue
    }
    if (c === "'") {
      enCadena = true
      r.push(-1)
      continue
    }
    if (c === '(') {
      r.push(d)
      d++
      continue
    }
    if (c === ')') {
      d--
      r.push(d)
      continue
    }
    r.push(d)
  }
  return r
}

/** Posiciones de `re` (con `g`) que empiezan a nivel 0 y fuera de cadenas. */
function arriba(s: string, re: RegExp): { i: number; m: RegExpExecArray }[] {
  const n = niveles(s)
  const out: { i: number; m: RegExpExecArray }[] = []
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    if (n[m.index] === 0) out.push({ i: m.index, m })
    if (m[0].length === 0) re.lastIndex++
  }
  return out
}

function partir(s: string, re: RegExp): string[] {
  const cortes = arriba(s, re)
  const out: string[] = []
  let desde = 0
  for (const { i, m } of cortes) {
    out.push(s.slice(desde, i).trim())
    desde = i + m[0].length
  }
  out.push(s.slice(desde).trim())
  return out
}

/** El índice del `)` que cierra el `(` de `abre`. */
function cierra(s: string, abre: number): number {
  let d = 0
  let enCadena = false
  for (let i = abre; i < s.length; i++) {
    const c = s[i]
    if (enCadena) {
      if (c === "'") enCadena = false
      continue
    }
    if (c === "'") enCadena = true
    else if (c === '(') d++
    else if (c === ')') {
      d--
      if (d === 0) return i
    }
  }
  return -1
}

/** Quita los paréntesis que envuelven TODO y los casts del final. */
function pelar(e: string): string {
  let x = e.trim()
  for (;;) {
    const sinCast = x.replace(/::\s*[a-z_][\w.]*(\s*\[\])?$/, '').trim()
    if (sinCast !== x && niveles(x)[x.length - 1] === 0) {
      x = sinCast
      continue
    }
    if (x.startsWith('(') && cierra(x, 0) === x.length - 1) {
      x = x.slice(1, -1).trim()
      continue
    }
    return x
  }
}

/** ¿`e` es `<cabeza>( … )` con el paréntesis cerrando al final? */
function llamada(e: string, cabeza: RegExp): string | null {
  const m = cabeza.exec(e)
  if (!m || m.index !== 0) return null
  const abre = m[0].length - 1
  if (e[abre] !== '(' || cierra(e, abre) !== e.length - 1) return null
  return e.slice(abre + 1, -1)
}

// ─── Estructura de una consulta ────────────────────────────────────────────────────────────────

type Atadura =
  | { tipo: 'tabla'; nombre: string; anulable: boolean }
  | { tipo: 'cte'; nombre: string; anulable: boolean }
  | { tipo: 'sub'; consulta: string; anulable: boolean }
  | { tipo: 'funcion'; nombre: string; anulable: boolean }

interface Rama {
  items: string[]
  ataduras: Map<string, Atadura>
  where: string | null
  agrupa: boolean
  ctes: Map<string, string>
}

const PALABRAS = new Set([
  'on',
  'where',
  'join',
  'left',
  'right',
  'full',
  'inner',
  'cross',
  'group',
  'order',
  'limit',
  'union',
  'using',
])

function ctesDe(q: string, heredados: Map<string, string>): { ctes: Map<string, string>; resto: string } {
  const ctes = new Map(heredados)
  if (!/^with\s/.test(q)) return { ctes, resto: q }
  let i = 5
  for (;;) {
    const m = /^\s*([a-z_]\w*)\s*(\([^)]*\))?\s+as\s+(not\s+materialized\s+|materialized\s+)?\(/.exec(q.slice(i))
    if (!m) throw new Error(`WITH sin entender: ${q.slice(i, i + 60)}`)
    const abre = i + m[0].length - 1
    const fin = cierra(q, abre)
    ctes.set(m[1]!, q.slice(abre + 1, fin).trim())
    i = fin + 1
    const sig = /^\s*,/.exec(q.slice(i))
    if (!sig) break
    i += sig[0].length
  }
  return { ctes, resto: q.slice(i).trim() }
}

function ataduras(from: string, ctes: Map<string, string>): Map<string, Atadura> {
  const r = new Map<string, Atadura>()
  if (from === '') return r
  const cortes = arriba(from, /,|\b(left|right|full|inner|cross)?\s*(outer\s+)?join\b/g)
  const piezas: { tipo: string; texto: string }[] = []
  let desde = 0
  let tipo = 'from'
  for (const { i, m } of cortes) {
    piezas.push({ tipo, texto: from.slice(desde, i).trim() })
    tipo = m[0] === ',' ? 'cross' : (m[1] ?? 'inner')
    desde = i + m[0].length
  }
  piezas.push({ tipo, texto: from.slice(desde).trim() })
  const todoAnulable = piezas.some((p) => p.tipo === 'right' || p.tipo === 'full')
  for (const p of piezas) {
    const anulable = todoAnulable || p.tipo === 'left'
    let t = p.texto.replace(/^lateral\s+/, '')
    const on = arriba(t, /\s(on|using)\s/g)[0]
    if (on) t = t.slice(0, on.i).trim()
    let fuente: Atadura
    let resto: string
    if (t.startsWith('(')) {
      const fin = cierra(t, 0)
      fuente = { tipo: 'sub', consulta: t.slice(1, fin).trim(), anulable }
      resto = t.slice(fin + 1).trim()
    } else {
      const m = /^([a-z_][\w]*(?:\.[a-z_]\w*)?)/.exec(t)
      if (!m) continue
      const nombre = m[1]!
      let fin = m[0].length
      if (t[fin] === '(') {
        fin = cierra(t, fin) + 1
        fuente = {
          tipo: 'funcion',
          nombre: nombre.includes('.') ? nombre : `public.${nombre}`,
          anulable,
        }
      } else if (!nombre.includes('.') && ctes.has(nombre)) {
        fuente = { tipo: 'cte', nombre, anulable }
      } else {
        fuente = { tipo: 'tabla', nombre: nombre.includes('.') ? nombre : `public.${nombre}`, anulable }
      }
      resto = t.slice(fin).trim()
    }
    const a = /^(?:as\s+)?([a-z_]\w*)/.exec(resto)
    const alias =
      a && !PALABRAS.has(a[1]!)
        ? a[1]!
        : fuente.tipo === 'tabla' || fuente.tipo === 'cte' || fuente.tipo === 'funcion'
          ? fuente.nombre.split('.').pop()!
          : null
    if (alias) r.set(alias, fuente)
  }
  return r
}

function ramas(consulta: string, heredados: Map<string, string>): Rama[] {
  const { ctes, resto } = ctesDe(normalizar(consulta).replace(/;\s*$/, ''), heredados)
  if (arriba(resto, /\b(intersect|except)\b/g).length > 0) throw new Error('INTERSECT/EXCEPT')
  return partir(resto, /\bunion(\s+all)?\b/g).map((r) => {
    let s = r
    const corte = arriba(s, /\b(order\s+by|limit)\b/g)[0]
    if (corte) s = s.slice(0, corte.i).trim()
    const sel = /^select\s+(distinct\s+on\s*\(|distinct\s+)?/.exec(s)
    if (!sel) throw new Error(`rama sin SELECT: ${s.slice(0, 60)}`)
    let i = sel[0].length
    if (sel[1]?.startsWith('distinct on')) i = cierra(s, i - 1) + 1
    const cuerpo = s.slice(i)
    const from = arriba(cuerpo, /\bfrom\b/g)[0]
    const lista = from ? cuerpo.slice(0, from.i) : cuerpo
    const tras = from ? cuerpo.slice(from.i + 4) : ''
    const cortes = arriba(tras, /\b(where|group\s+by|having)\b/g)
    const fromTexto = cortes[0] ? tras.slice(0, cortes[0].i).trim() : tras.trim()
    let where: string | null = null
    const w = cortes.find((c) => c.m[1] === 'where')
    if (w) {
      const sig = cortes.find((c) => c.i > w.i)
      where = tras.slice(w.i + 5, sig ? sig.i : undefined).trim()
    }
    const agrupa = cortes.some((c) => c.m[1]!.startsWith('group'))
    return { items: partir(lista, /,/g), ataduras: ataduras(fromTexto, ctes), where, agrupa, ctes }
  })
}

function nombreDe(item: string): { nombre: string | null; expr: string } {
  const as = arriba(item, /\sas\s+([a-z_]\w*)$/g)[0]
  if (as) return { nombre: as.m[1]!, expr: item.slice(0, as.i).trim() }
  const col = /^[a-z_]\w*\.([a-z_]\w*)$/.exec(item) ?? /^([a-z_]\w*)$/.exec(item)
  return { nombre: col ? col[1]! : null, expr: item }
}

/** La consulta que devuelve una función: el cuerpo entero (sql) o su único `RETURN QUERY`. */
function consultaDe(f: FuncionCatalogo): string {
  const c = normalizar(f.cuerpo)
  if (f.lenguaje === 'sql') return c
  // Una función con RETURN NEXT, o con más de un RETURN QUERY, no se lee: se rechaza.
  const todos = arriba(c, /\breturn\s+query\s/g).map((x) => x.m)
  if (todos.length !== 1) throw new Error(`${f.nombre}: no tiene un único RETURN QUERY`)
  const ini = todos[0]!.index! + todos[0]![0].length
  const fin = arriba(c.slice(ini), /;/g)[0]
  if (!fin) throw new Error(`${f.nombre}: RETURN QUERY sin ;`)
  return c.slice(ini, ini + fin.i)
}

// ─── El juicio ─────────────────────────────────────────────────────────────────────────────────

export class Analizador {
  private funciones: Map<string, FuncionCatalogo>
  private noNulas: Set<string>

  constructor(cat: Catalogo) {
    this.funciones = new Map(cat.funciones.map((f) => [f.nombre, f]))
    this.noNulas = new Set(cat.noNulas)
  }

  /** ¿La columna `columna` de la función `esquema.nombre` es no nula por las reglas? */
  columna(funcion: string, columna: string, prof = 0): Veredicto {
    if (prof > 8) return no('demasiada profundidad')
    const f = this.funciones.get(funcion)
    if (!f) return no(`${funcion}: no está en el catálogo`)
    const i = f.columnas.indexOf(columna)
    if (i < 0) return no(`${funcion}: no tiene la columna ${columna}`)
    let rs: Rama[]
    try {
      rs = ramas(consultaDe(f), new Map())
    } catch (e) {
      return no(`${funcion}: ${e instanceof Error ? e.message : String(e)}`)
    }
    return this.enRamas(rs, i, columna, prof, funcion)
  }

  private enRamas(rs: Rama[], i: number, columna: string, prof: number, donde: string): Veredicto {
    const porques: string[] = []
    for (const [k, r] of rs.entries()) {
      // `SELECT * FROM una_fuente`: la columna, por su nombre, en esa fuente.
      if (r.items.length === 1 && r.items[0] === '*' && r.ataduras.size === 1) {
        const [alias] = [...r.ataduras.keys()]
        const v = this.expr(`${alias}.${columna}`, r, prof + 1)
        if (!v.ok) return no(`${donde}, rama ${k + 1}: ${v.porque}`)
        porques.push(v.porque)
        continue
      }
      const item = r.items[i]
      if (item === undefined) return no(`${donde}, rama ${k + 1}: sin la posición ${i + 1}`)
      const v = this.expr(nombreDe(item).expr, r, prof + 1)
      if (!v.ok) return no(`${donde}, rama ${k + 1}: ${v.porque}`)
      porques.push(v.porque)
    }
    return si(porques.join(' | '))
  }

  private porNombre(consulta: string, ctes: Map<string, string>, col: string, prof: number): Veredicto {
    let rs: Rama[]
    try {
      rs = ramas(consulta, ctes)
    } catch (e) {
      return no(e instanceof Error ? e.message : String(e))
    }
    const primera = rs[0]!
    const i = primera.items.findIndex((it) => nombreDe(it).nombre === col)
    if (i < 0) return no(`la consulta no tiene ${col} con nombre`)
    return this.enRamas(rs, i, col, prof, `«${col}»`)
  }

  private expr(expr: string, r: Rama, prof: number): Veredicto {
    if (prof > 12) return no('demasiada profundidad')
    const e = pelar(expr)

    // Un filtro `e IS NOT NULL` en el WHERE de esta misma consulta.
    if (r.where && partir(r.where, /\band\b/g).some((c) => pelar(c) === `${e} is not null`)) {
      return si(`filtro: ${e} is not null`)
    }
    if (/^'(?:[^']|'')*'$/.test(e) || /^-?\d+(\.\d+)?$/.test(e) || e === 'true' || e === 'false') {
      return si(`literal ${e}`)
    }
    if (/\sis\s+(not\s+)?null$/.test(e) && arriba(e, /\s(and|or)\s/g).length === 0) {
      return si('is [not] null')
    }
    if (llamada(e, /^(not\s+)?exists\s*\(/) !== null) return si('[not] exists')
    if (llamada(e, /^count\s*\(/) !== null) return si('count')
    if (/^select\s/.test(e)) {
      let rs: Rama[]
      try {
        rs = ramas(e, r.ctes)
      } catch {
        return no('subconsulta sin entender')
      }
      const sola = rs.length === 1 ? rs[0]! : null
      if (sola && sola.items.length === 1 && !sola.agrupa && llamada(pelar(sola.items[0]!), /^count\s*\(/) !== null) {
        return si('subconsulta de count')
      }
      return no(`subconsulta escalar (puede no dar fila): ${e.slice(0, 50)}`)
    }
    const co = llamada(e, /^coalesce\s*\(/)
    if (co !== null) {
      const args = partir(co, /,/g)
      const v = this.expr(args[args.length - 1]!, r, prof + 1)
      return v.ok ? si(`coalesce(…, ${v.porque})`) : no(`coalesce sin último no nulo: ${v.porque}`)
    }
    if (/^case\s/.test(e) && /\send$/.test(e)) return this.caso(e, r, prof)
    const col = /^([a-z_]\w*)\.([a-z_]\w*)$/.exec(e)
    if (col) return this.ref(col[1]!, col[2]!, r, prof)
    return no(`fuera de las reglas: ${e.slice(0, 60)}`)
  }

  private caso(e: string, r: Rama, prof: number): Veredicto {
    const cuerpo = e.slice(5, -4)
    const n = niveles(cuerpo)
    const toks = [...cuerpo.matchAll(/\b(case|when|then|else|end)\b/g)].filter((m) => n[m.index!] === 0)
    let anid = 0
    const marcas: { pal: string; i: number; fin: number }[] = []
    for (const t of toks) {
      if (t[1] === 'case') anid++
      else if (t[1] === 'end') anid--
      else if (anid === 0) marcas.push({ pal: t[1]!, i: t.index!, fin: t.index! + t[0].length })
    }
    if (!marcas.some((m) => m.pal === 'else')) return no('CASE sin ELSE')
    for (const [k, m] of marcas.entries()) {
      if (m.pal !== 'then' && m.pal !== 'else') continue
      const hasta = marcas[k + 1]?.i ?? cuerpo.length
      const v = this.expr(cuerpo.slice(m.fin, hasta), r, prof + 1)
      if (!v.ok) return no(`CASE con una rama que puede ser NULL: ${v.porque}`)
    }
    return si('CASE con ELSE y todas las ramas no nulas')
  }

  private ref(alias: string, col: string, r: Rama, prof: number): Veredicto {
    const a = r.ataduras.get(alias)
    if (!a) return no(`${alias}.${col}: alias sin atar (variable o fuera de alcance)`)
    if (a.anulable) return no(`${alias}.${col}: ${alias} viene de un LEFT/RIGHT/FULL JOIN`)
    switch (a.tipo) {
      case 'tabla':
        return this.noNulas.has(`${a.nombre}.${col}`)
          ? si(`${a.nombre}.${col} NOT NULL`)
          : no(`${a.nombre}.${col} admite NULL`)
      case 'cte': {
        const v = this.porNombre(r.ctes.get(a.nombre)!, r.ctes, col, prof + 1)
        return v.ok ? si(`${a.nombre}.${col} → ${v.porque}`) : no(`${a.nombre}.${col} → ${v.porque}`)
      }
      case 'sub': {
        const v = this.porNombre(a.consulta, r.ctes, col, prof + 1)
        return v.ok ? si(`(sub).${col} → ${v.porque}`) : no(`(sub).${col} → ${v.porque}`)
      }
      case 'funcion': {
        const v = this.columna(a.nombre, col, prof + 1)
        return v.ok ? si(`${a.nombre}().${col} → ${v.porque}`) : no(`${a.nombre}().${col} → ${v.porque}`)
      }
    }
  }
}
