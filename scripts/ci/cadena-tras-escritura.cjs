#!/usr/bin/env node
// Escáner de cadena del censo C (decisiones de Jose del 2026-11-25): «que el escaneo siga la cadena de
// llamadas, no solo el cuerpo de la función, y dame el NÚMERO» y «el escáner de cadena como paso de CI
// esperando 0 reales, y los 15 en una lista con su motivo escrito que solo puede encoger».
//
// Mide dos cosas sobre `src` (sin tests), con el checker de TypeScript resolviendo cada llamada a su
// declaración y un punto fijo sobre el grafo de llamadas:
//
//  1. «SE GUARDÓ Y TE DIGO QUE NO»: un punto de entrada (acción exportada de un fichero 'use server', o el
//     GET/POST/… de un route.ts) en el que, después de una ESCRITURA, viene una PARADA por lectura fallida.
//       ESCRIBE: insert/update/upsert/delete de una cadena `.from(…)`; upload/remove/move/copy de
//         `.storage.from(…)`; `.rpc('f')` con `f` VOLATILE (la volatilidad sale de la última definición de
//         `f` en `supabase/migrations`; una función que no está allí cuenta como que escribe); o una llamada
//         a una función que ESCRIBE.
//       PARA: `throw new LecturaFallida`, `return fail('common.lectura_fallida')`, o una llamada a una
//         función que PARA, fuera de un `try` cuyo `catch` se lo trague (un `catch` que devuelve fail/err o
//         lanza es otra forma de decir «no»). Una llamada pasada a `siFallaTrasEscribir(…)` u `oNoLeido(…)`
//         no para ni lanza: las dos la recogen.
//     Esperado: 0 fuera de la lista (`cadena-tras-escritura.lista.json`, cada una con su motivo).
//
//  2. LA FRONTERA DE LAS ACCIONES: una acción exportada de un 'use server' no deja escapar una
//     `LecturaFallida` (convención: «Server Actions: patrón Result, nunca throw visible al cliente»).
//     LANZA: un `throw new LecturaFallida` o una llamada a una función que LANZA, fuera de un `try` con
//     `catch` (aquí cualquier catch que no relance la recoge). Esperado: 0.
//
// Aproximaciones (dan FALSOS POSITIVOS, no huecos): orden de texto y no de flujo (una escritura en una
// rama que devuelve antes cuenta); las funciones anidadas se leen donde están escritas; una RPC volátil
// puede no escribir. Huecos declarados: llamadas que el checker no resuelve (dinámicas); escrituras que no
// son Supabase (correo, push), que no son «guardado».
//
// Uso:  node scripts/ci/cadena-tras-escritura.cjs            (comprueba contra la lista; exit 1 si no cuadra)
//       node scripts/ci/cadena-tras-escritura.cjs --informe f.json   (además escribe el detalle)
//       node scripts/ci/cadena-tras-escritura.cjs --vol prod.json    (volatilidad leída de producción, el control)
const path = require('path')
const fs = require('fs')
const ts = require('typescript')

/** La volatilidad de cada función de `public` según la ÚLTIMA definición en las migraciones. */
function volatilidadDeMigraciones(dirMigraciones) {
  const vol = new Map()
  const ficheros = fs
    .readdirSync(dirMigraciones)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  const reCrear =
    /create\s+(?:or\s+replace\s+)?function\s+(?:(public|"public")\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi
  for (const f of ficheros) {
    const sql = fs.readFileSync(path.join(dirMigraciones, f), 'utf8')
    let m
    reCrear.lastIndex = 0
    while ((m = reCrear.exec(sql))) {
      // Solo `public` (o sin esquema, que en estas migraciones es public); `privado.x` no es una RPC.
      const antes = sql.slice(Math.max(0, m.index - 0), m.index + m[0].length)
      if (/function\s+[a-z_]+\./i.test(antes) && !m[1]) continue
      const nombre = m[2].toLowerCase()
      const desde = m.index + m[0].length
      const as = /\bas\s+(\$[a-z_]*\$|')/gi
      as.lastIndex = desde
      const ma = as.exec(sql)
      if (!ma) continue
      const cabecera = sql.slice(desde, ma.index)
      const marca = ma[1]
      const finCuerpo = sql.indexOf(marca, ma.index + ma[0].length)
      if (finCuerpo < 0) continue
      const puntoYComa = sql.indexOf(';', finCuerpo + marca.length)
      const cola = sql.slice(finCuerpo + marca.length, puntoYComa < 0 ? undefined : puntoYComa)
      const atrs = (cabecera + ' ' + cola).toLowerCase()
      const v = /\bimmutable\b/.test(atrs) ? 'i' : /\bstable\b/.test(atrs) ? 's' : 'v'
      vol.set(nombre, v)
      reCrear.lastIndex = puntoYComa < 0 ? sql.length : puntoYComa
    }
    const reAlter =
      /alter\s+function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\([^)]*\)\s+(stable|immutable|volatile)\b/gi
    while ((m = reAlter.exec(sql))) vol.set(m[1].toLowerCase(), m[2][0].toLowerCase())
  }
  return vol
}

/**
 * Analiza un árbol. `raiz` tiene `tsconfig.json`; `vol` es un Map nombre → 'v'|'s'|'i'.
 * Devuelve { entradas, accionesQueLanzan, funciones, rpcsDesconocidas }.
 */
function analizar(raiz, vol) {
  const cfg = ts.readConfigFile(path.join(raiz, 'tsconfig.json'), ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, raiz)
  const program = ts.createProgram(parsed.fileNames, parsed.options)
  const checker = program.getTypeChecker()

  const esFuente = (sf) => {
    const rel = path.relative(raiz, sf.fileName).split(path.sep).join('/')
    return (
      rel.startsWith('src/') &&
      !/__tests__|\.test\.|^src\/test\//.test(rel) &&
      !sf.isDeclarationFile
    )
  }
  const fuentes = program.getSourceFiles().filter(esFuente)
  const rpcsDesconocidas = new Set()
  const ESC_METODO = /^(insert|update|upsert|delete)$/
  const ESC_STORAGE = /^(upload|remove|move|copy)$/

  function escrituraDirecta(call) {
    if (!ts.isPropertyAccessExpression(call.expression)) return null
    const m = call.expression.name.text
    if (m === 'rpc') {
      const a = call.arguments[0]
      if (!a || !ts.isStringLiteralLike(a)) return 'rpc ?'
      const v = vol.get(a.text.toLowerCase())
      if (v === undefined) {
        rpcsDesconocidas.add(a.text)
        return `rpc ${a.text} (sin definición)`
      }
      return v === 'v' ? `rpc ${a.text}` : null
    }
    let cur = call.expression.expression
    let haciaFrom = false
    let storage = false
    while (cur) {
      if (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
        if (cur.expression.name.text === 'from') haciaFrom = true
        cur = cur.expression.expression
        continue
      }
      if (ts.isPropertyAccessExpression(cur)) {
        if (cur.name.text === 'storage') storage = true
        cur = cur.expression
        continue
      }
      break
    }
    if (!haciaFrom) return null
    if (storage && ESC_STORAGE.test(m)) return `storage.${m}`
    if (!storage && ESC_METODO.test(m)) return m
    return null
  }

  const esNew = (n) => n && ts.isNewExpression(n) && n.expression.getText() === 'LecturaFallida'
  function paradaDirecta(n) {
    if (ts.isThrowStatement(n) && esNew(n.expression)) return 'throw LecturaFallida'
    if (
      ts.isReturnStatement(n) &&
      n.expression &&
      ts.isCallExpression(n.expression) &&
      n.expression.expression.getText() === 'fail'
    ) {
      const a = n.expression.arguments[0]
      if (a && ts.isStringLiteralLike(a) && a.text === 'common.lectura_fallida')
        return "return fail('common.lectura_fallida')"
    }
    return null
  }

  function destino(call) {
    let sym = checker.getSymbolAtLocation(call.expression)
    if (!sym && ts.isPropertyAccessExpression(call.expression))
      sym = checker.getSymbolAtLocation(call.expression.name)
    if (!sym) return null
    if (sym.flags & ts.SymbolFlags.Alias) {
      try {
        sym = checker.getAliasedSymbol(sym)
      } catch {
        return null
      }
    }
    for (const d of sym.declarations ?? []) {
      if (!esFuente(d.getSourceFile())) continue
      if ((ts.isFunctionDeclaration(d) || ts.isMethodDeclaration(d)) && d.body) return d
      if (ts.isVariableDeclaration(d) && d.initializer) {
        let ini = d.initializer
        if (
          ts.isCallExpression(ini) &&
          ini.arguments[0] &&
          (ts.isArrowFunction(ini.arguments[0]) || ts.isFunctionExpression(ini.arguments[0]))
        )
          ini = ini.arguments[0]
        if (ts.isArrowFunction(ini) || ts.isFunctionExpression(ini)) return ini
      }
    }
    return null
  }

  const funciones = new Map()
  function nombreDe(fn) {
    if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text
    let p = fn.parent
    if (ts.isCallExpression(p)) p = p.parent
    if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text
    return null
  }
  function esRaiz(fn) {
    let p = fn.parent
    while (p) {
      if (ts.isFunctionLike(p) && funciones.has(p)) return false
      p = p.parent
    }
    return true
  }
  for (const sf of fuentes) {
    const visitar = (n) => {
      if (
        (ts.isFunctionDeclaration(n) ||
          ts.isMethodDeclaration(n) ||
          ts.isArrowFunction(n) ||
          ts.isFunctionExpression(n)) &&
        n.body &&
        nombreDe(n) &&
        esRaiz(n)
      ) {
        funciones.set(n, { nombre: nombreDe(n), sf, eventos: [] })
      }
      ts.forEachChild(n, visitar)
    }
    visitar(sf)
  }

  /** El `try` que envuelve `n` dentro de `fn`, con su catch; o null. */
  function tryDe(n, fn) {
    let c = n
    while (c && c !== fn) {
      const p = c.parent
      if (p && ts.isTryStatement(p) && p.tryBlock === c && p.catchClause) return p
      c = p
    }
    return null
  }
  const catchDiceNo = (t) =>
    /\bthrow\b|return\s+(fail|err|falloDeLectura)\(|success:\s*false|ok:\s*false/.test(
      t.catchClause.getText()
    )
  const catchRelanza = (t) => /\bthrow\b/.test(t.catchClause.getText())
  // Envoltorios que recogen la LecturaFallida de la llamada que reciben: `siFallaTrasEscribir` (devuelve el
  // valor de repuesto) y `oNoLeido` (devuelve null y la sección lo dice: PR A). Por el nombre.
  const ENVUELVEN = new Set(['siFallaTrasEscribir', 'oNoLeido'])
  const dentroDeSiFalla = (n, fn) => {
    let c = n
    while (c && c !== fn) {
      const p = c.parent
      if (
        p &&
        ts.isCallExpression(p) &&
        p.arguments.includes(c) &&
        ENVUELVEN.has(p.expression.getText())
      )
        return true
      c = p
    }
    return false
  }

  for (const [fn, info] of funciones) {
    const visitar = (n) => {
      if (ts.isCallExpression(n)) {
        const e = escrituraDirecta(n)
        if (e) info.eventos.push({ tipo: 'escribe', pos: n.getStart(), que: e })
        const d = destino(n)
        if (d && d !== fn) {
          const t = tryDe(n, fn)
          const siFalla = dentroDeSiFalla(n, fn)
          info.eventos.push({
            tipo: 'llama',
            pos: n.getStart(),
            a: d,
            // para «para»: protege un catch que se lo traga, o siFallaTrasEscribir
            noPara: siFalla || (t ? !catchDiceNo(t) : false),
            // para «lanza»: protege cualquier catch que no relance, o siFallaTrasEscribir
            noLanza: siFalla || (t ? !catchRelanza(t) : false),
          })
        }
      }
      const p = paradaDirecta(n)
      if (p) {
        const t = tryDe(n, fn)
        info.eventos.push({
          tipo: 'para',
          pos: n.getStart(),
          que: p,
          noPara: t ? !catchDiceNo(t) : false,
          noLanza: p.startsWith('return') || (t ? !catchRelanza(t) : false),
        })
      }
      ts.forEachChild(n, visitar)
    }
    ts.forEachChild(fn, visitar)
    info.eventos.sort((a, b) => a.pos - b.pos)
  }
  const raizDe = (n) => {
    let c = n
    while (c) {
      if (funciones.has(c)) return c
      c = c.parent
    }
    return null
  }
  for (const info of funciones.values())
    for (const ev of info.eventos) if (ev.tipo === 'llama') ev.a = raizDe(ev.a)

  for (const info of funciones.values())
    Object.assign(info, { escribe: false, para: false, lanza: false, tras: false })
  let cambio = true
  while (cambio) {
    cambio = false
    for (const info of funciones.values()) {
      let escribe = false
      let para = false
      let lanza = false
      let tras = false
      let yaEscribio = false
      for (const ev of info.eventos) {
        const callee = ev.tipo === 'llama' && ev.a ? funciones.get(ev.a) : null
        const esParada = (ev.tipo === 'para' && !ev.noPara) || (callee && callee.para && !ev.noPara)
        if (esParada) {
          para = true
          if (yaEscribio) tras = true
        }
        if ((ev.tipo === 'para' && !ev.noLanza) || (callee && callee.lanza && !ev.noLanza))
          lanza = true
        if (callee && callee.tras && !ev.noPara) tras = true
        if (ev.tipo === 'escribe' || (callee && callee.escribe)) {
          escribe = true
          yaEscribio = true
        }
      }
      if (
        escribe !== info.escribe ||
        para !== info.para ||
        lanza !== info.lanza ||
        tras !== info.tras
      ) {
        Object.assign(info, { escribe, para, lanza, tras })
        cambio = true
      }
    }
  }

  const rel = (sf) => path.relative(raiz, sf.fileName).split(path.sep).join('/')
  const linea = (sf, pos) => sf.getLineAndCharacterOfPosition(pos).line + 1
  /** Por qué: la escritura y la parada (o la llamada que la lleva dentro) de cada función que la tiene. */
  // TODAS las paradas, no solo la primera (decisión de Jose del 2026-11-25: «si no, el número que da
  // vuelve a ser un suelo sin que lo sepamos»). Para cada función, cada parada que viene después de su
  // primera escritura; y cada parada que llega por una llamada se abre hasta sus HOJAS: las líneas que
  // lanzan o devuelven el fallo. Los sitios raíz son la unión de esas hojas.
  const hojasMemo = new Map()
  function hojas(info, enCurso = new Set()) {
    if (hojasMemo.has(info)) return hojasMemo.get(info)
    if (enCurso.has(info)) return new Set()
    enCurso.add(info)
    const out = new Set()
    for (const ev of info.eventos) {
      if (ev.noPara) continue
      if (ev.tipo === 'para') out.add(`${rel(info.sf)}:${linea(info.sf, ev.pos)} ${ev.que}`)
      const callee = ev.tipo === 'llama' && ev.a ? funciones.get(ev.a) : null
      if (callee && callee.para) for (const h of hojas(callee, enCurso)) out.add(h)
    }
    enCurso.delete(info)
    hojasMemo.set(info, out)
    return out
  }
  const porque = {}
  const raicesDe = {}
  function explicar(info, enCurso = new Set()) {
    const clave = `${rel(info.sf)}#${info.nombre}`
    if (porque[clave] || enCurso.has(clave)) return
    enCurso.add(clave)
    const lineas = []
    const raices = new Set()
    let primera = null
    for (const ev of info.eventos) {
      const callee = ev.tipo === 'llama' && ev.a ? funciones.get(ev.a) : null
      if (callee && callee.tras && !ev.noPara) {
        const cc = `${rel(callee.sf)}#${callee.nombre}`
        explicar(callee, enCurso)
        lineas.push(`l${linea(info.sf, ev.pos)} llama a ${cc}, que lo lleva dentro`)
        for (const r of raicesDe[cc] ?? []) raices.add(r)
      }
      const esParada = (ev.tipo === 'para' && !ev.noPara) || (callee && callee.para && !ev.noPara)
      if (esParada && primera) {
        if (ev.tipo === 'para') {
          const h = `${rel(info.sf)}:${linea(info.sf, ev.pos)} ${ev.que}`
          lineas.push(`escribe l${linea(info.sf, primera.pos)} (${primera.que}) · para ${h}`)
          raices.add(h)
        } else {
          const hs = [...hojas(callee)]
          lineas.push(
            `escribe l${linea(info.sf, primera.pos)} (${primera.que}) · para l${linea(info.sf, ev.pos)} por ${rel(callee.sf)}#${callee.nombre}, en: ${hs.join(' | ')}`
          )
          for (const h of hs) raices.add(h)
        }
      }
      if (!primera && ev.tipo === 'escribe') primera = ev
      else if (!primera && callee && callee.escribe)
        primera = { pos: ev.pos, que: `${callee.nombre}, que escribe` }
    }
    porque[clave] = lineas
    raicesDe[clave] = [...raices].sort()
    enCurso.delete(clave)
  }
  for (const info of funciones.values()) if (info.tras) explicar(info)
  const usaServer = (sf) => /^\s*['"]use server['"]/.test(sf.getFullText())
  const exportada = (fn) => {
    const decl = fn.parent && ts.isVariableDeclaration(fn.parent) ? fn.parent.parent.parent : fn
    return !!(ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Export)
  }
  const entradas = []
  const accionesQueLanzan = []
  for (const [fn, info] of funciones) {
    const r = rel(info.sf)
    const esAccion = usaServer(info.sf) && exportada(fn)
    const esRuta = /\/route\.ts$/.test(r) && /^(GET|POST|PUT|PATCH|DELETE)$/.test(info.nombre)
    if ((esAccion || esRuta) && info.tras) entradas.push(`${r}#${info.nombre}`)
    if (esAccion && info.lanza) accionesQueLanzan.push(`${r}#${info.nombre}`)
  }
  const sitiosRaiz = [...new Set(entradas.flatMap((e) => raicesDe[e] ?? []))].sort()
  return {
    entradas: entradas.sort(),
    accionesQueLanzan: accionesQueLanzan.sort(),
    funciones: funciones.size,
    rpcsDesconocidas: [...rpcsDesconocidas].sort(),
    porque,
    raicesDe,
    sitiosRaiz,
  }
}

/**
 * La lista y su norma (Jose, 2026-11-27, `_norma` en la propia lista): «la lista solo puede encoger» va contra
 * acumular excusas, no contra anotar un pendiente trazado. Cada entrada es de una clase ya explicada —falso
 * positivo, tratado, fichero huérfano— o un PENDIENTE con su PR destino y su fecha (`Destino: PR <x> ·
 * <AAAA-MM-DD>`). Una entrada sin eso no entra nunca. Las claves que empiezan por `_` no son entradas.
 */
const CLASE_EXPLICADA = /^(Falso positivo|Tratado|Fichero huérfano)\b/
const PENDIENTE_CON_DUENO = /^Pendiente · Destino: PR \S+ · \d{4}-\d{2}-\d{2}\b/
function leerLista(lista) {
  const entradas = Object.keys(lista).filter((k) => !k.startsWith('_'))
  const sinClase = entradas.filter((k) => {
    const motivo = String(lista[k] ?? '')
    return !CLASE_EXPLICADA.test(motivo) && !PENDIENTE_CON_DUENO.test(motivo)
  })
  return { entradas, sinClase }
}

module.exports = { analizar, volatilidadDeMigraciones, leerLista }

if (require.main === module) {
  const raiz = process.cwd()
  const args = process.argv.slice(2)
  const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null)
  let vol = volatilidadDeMigraciones(path.join(raiz, 'supabase/migrations'))
  if (opt('--vol')) {
    const prod = JSON.parse(fs.readFileSync(opt('--vol'), 'utf8'))
    vol = new Map(prod[0].json_agg.map((x) => [x.n, x.v]))
  }
  const t0 = Date.now()
  const r = analizar(raiz, vol)
  const lista = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'cadena-tras-escritura.lista.json'), 'utf8')
  )
  const { entradas: enLista, sinClase } = leerLista(lista)
  const admitidas = new Set(enLista)
  const nuevas = r.entradas.filter((e) => !admitidas.has(e))
  const sobran = [...admitidas].filter((e) => !r.entradas.includes(e))
  console.log(
    `funciones ${r.funciones} · entradas «se guardó y te digo que no» ${r.entradas.length} (en la lista ${admitidas.size}) · sus sitios raíz, todos ${r.sitiosRaiz.length} · acciones que dejan escapar LecturaFallida ${r.accionesQueLanzan.length} · ${Math.round((Date.now() - t0) / 1000)} s`
  )
  if (opt('--informe')) fs.writeFileSync(opt('--informe'), JSON.stringify(r, null, 1))
  let mal = false
  for (const e of nuevas) {
    console.log(`  NUEVA (se guardó y te digo que no): ${e}`)
    for (const l of r.porque[e] ?? []) console.log(`      ${l}`)
    mal = true
  }
  for (const e of sobran) {
    console.log(`  SOBRA en la lista (ya no aparece: quítala, la lista solo encoge): ${e}`)
    mal = true
  }
  for (const e of sinClase) {
    console.log(
      `  SIN DESTINO NI CLASE en la lista (ver _norma: un pendiente lleva «Pendiente · Destino: PR <x> · <fecha>»): ${e}`
    )
    mal = true
  }
  for (const e of r.accionesQueLanzan) {
    console.log(
      `  ACCIÓN que deja escapar LecturaFallida (envuélvela con conFronteraDeLectura): ${e}`
    )
    mal = true
  }
  if (mal) process.exit(1)
  console.log('OK')
}
