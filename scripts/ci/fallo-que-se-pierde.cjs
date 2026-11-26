#!/usr/bin/env node
// El fallo que se pierde entre un helper y quien lo llama (censo C, decisión de Jose del 2026-11-26): «Mídelo
// con el compilador, como hiciste con el escáner de cadena […] Dame el número exacto con sus huecos declarados,
// no un suelo» y «que el número salga del tipo, no de una lista de nombres».
//
// CLASE 2 · EL CONSTRUCTOR DE LA CONSULTA. Un helper cuyo tipo de retorno es un constructor de PostgREST
// (`Postgrest*Builder`, por el símbolo del tipo) o la respuesta cruda (`{ data, error, status }`, por la forma
// del tipo esperado): el `error` viaja hasta quien lo llama, y ni el censo (busca `.from(` dentro de cada
// función) ni el lint (mira la cadena literal) lo ven allí. Cada llamada que el checker resuelve a uno de esos
// helpers es un SITIO; se sube por el encadenado (`.eq()`, `.limit()`) hasta quien consume el resultado:
//   MIRA      `await` → `{ error }` desestructurado y USADO, o `r.error` leído.
//   NO_MIRA   `await` → desestructurado sin `error` (o con `error` sin usar), o el resultado tirado.
//   PASA      `return` (con o sin await): quien lo hace es a su vez un helper de la clase y se mide en SUS sitios.
//   HUECO     cualquier otra forma de consumir (argumento de otra función, `.then`, una variable que se
//             reasigna fuera de un encadenado…): se cuenta y se lista, no se clasifica.
//
// Uso:  node scripts/ci/fallo-que-se-pierde.cjs [--informe f.json]
const path = require('path')
const fs = require('fs')
const ts = require('typescript')

const BUILDER = /^Postgrest\w*Builder$/

function programa(raiz) {
  const cfg = ts.readConfigFile(path.join(raiz, 'tsconfig.json'), ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, raiz)
  return ts.createProgram(parsed.fileNames, parsed.options)
}

const esFuente = (raiz, sf) => {
  const rel = path.relative(raiz, sf.fileName)
  return (
    rel.startsWith('src' + path.sep) &&
    !sf.isDeclarationFile &&
    !/__tests__|\.test\.|\/test\//.test(rel)
  )
}

function analizar(raiz) {
  const program = programa(raiz)
  const checker = program.getTypeChecker()
  const fuentes = program.getSourceFiles().filter((sf) => esFuente(raiz, sf))
  const rel = (n) => path.relative(raiz, n.getSourceFile().fileName)
  const linea = (n) => n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line + 1
  const donde = (n) => `${rel(n)}:${linea(n)}`

  const miembros = (t) => (t.isUnion() ? t.types : [t])
  const esBuilder = (t) =>
    miembros(t).some((m) => {
      const s = m.getSymbol() || m.aliasSymbol
      return !!s && BUILDER.test(s.getName())
    })
  const esperado = (t) => {
    const s = t.getSymbol()
    if (s && s.getName() === 'Promise') {
      const args = checker.getTypeArguments(t)
      if (args.length) return args[0]
    }
    return t
  }
  const esRespuesta = (t) => {
    const ms = miembros(esperado(t)).filter((m) => !(m.flags & ts.TypeFlags.Never))
    return (
      ms.length > 0 && ms.every((m) => ['data', 'error', 'status'].every((p) => m.getProperty(p)))
    )
  }

  // 1. Los helpers de la clase, por su tipo de retorno.
  const helpers = new Map() // declaración → { tipo, donde, nombre }
  const anonimas = []
  const nombreDe = (d) =>
    (d.name && d.name.getText()) ||
    (d.parent &&
      (ts.isVariableDeclaration(d.parent) || ts.isPropertyAssignment(d.parent)) &&
      d.parent.name.getText()) ||
    '(anónima)'
  for (const sf of fuentes) {
    const visitar = (n) => {
      if (ts.isFunctionLike(n) && n.body) {
        const sig = checker.getSignatureFromDeclaration(n)
        const r = sig && checker.getReturnTypeOfSignature(sig)
        const tipo = !r ? null : esBuilder(r) ? 'builder' : esRespuesta(r) ? 'respuesta' : null
        if (tipo) {
          // Con nombre (declaración, método, o asignada a una variable o a una propiedad): un helper, y
          // sus llamadas se resuelven. Sin nombre (pasada a otra función: un `.map`, un callback): un
          // HUECO declarado, porque quien la llama no es código nuestro.
          const conNombre =
            ts.isFunctionDeclaration(n) ||
            ts.isMethodDeclaration(n) ||
            (n.parent && (ts.isVariableDeclaration(n.parent) || ts.isPropertyAssignment(n.parent)))
          if (conNombre) helpers.set(n, { tipo, donde: donde(n), nombre: nombreDe(n) })
          else
            anonimas.push({
              tipo,
              donde: donde(n),
              en: n.parent ? ts.SyntaxKind[n.parent.kind] : '?',
            })
        }
      }
      ts.forEachChild(n, visitar)
    }
    visitar(sf)
  }

  // ¿Se usa este símbolo en algún sitio de su función, fuera de su declaración?
  const usosDe = (ident) => {
    const sym = checker.getSymbolAtLocation(ident)
    if (!sym) return []
    let scope = ident.parent
    while (scope && !ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) scope = scope.parent
    const usos = []
    const v = (n) => {
      if (ts.isIdentifier(n) && n !== ident && checker.getSymbolAtLocation(n) === sym) usos.push(n)
      ts.forEachChild(n, v)
    }
    v(scope)
    return usos
  }
  const sinEnvoltorio = (n) => {
    let p = n.parent
    while (
      p &&
      (ts.isParenthesizedExpression(p) ||
        ts.isAsExpression(p) ||
        ts.isNonNullExpression(p) ||
        ts.isSatisfiesExpression?.(p) ||
        // `cond ? await a() : await b()`: cada rama la consume quien consume la condicional.
        (ts.isConditionalExpression(p) && (p.whenTrue === n || p.whenFalse === n)))
    ) {
      n = p
      p = n.parent
    }
    return n
  }
  // Sube por el encadenado de métodos del constructor: `h().eq(…).limit(1)`.
  const subeEncadenado = (n) => {
    n = sinEnvoltorio(n)
    for (;;) {
      const p = n.parent
      if (
        p &&
        ts.isPropertyAccessExpression(p) &&
        p.expression === n &&
        p.name.text !== 'then' &&
        p.parent &&
        ts.isCallExpression(p.parent) &&
        p.parent.expression === p
      ) {
        n = sinEnvoltorio(p.parent)
        continue
      }
      return n
    }
  }

  // Qué hace con la respuesta una variable o un patrón de desestructuración.
  const deLaVinculacion = (nombre) => {
    if (ts.isObjectBindingPattern(nombre)) {
      const el = nombre.elements.find(
        (e) => (e.propertyName ? e.propertyName.getText() : e.name.getText()) === 'error'
      )
      if (!el) return { clase: 'NO_MIRA', como: 'desestructura sin error' }
      if (!ts.isIdentifier(el.name))
        return { clase: 'HUECO', como: 'error desestructurado en un patrón' }
      return usosDe(el.name).length
        ? { clase: 'MIRA', como: 'usa error' }
        : { clase: 'NO_MIRA', como: 'desestructura error y no lo usa' }
    }
    if (ts.isIdentifier(nombre)) {
      const usos = usosDe(nombre)
      if (
        usos.some((u) => ts.isPropertyAccessExpression(u.parent) && u.parent.name.text === 'error')
      )
        return { clase: 'MIRA', como: 'lee .error' }
      if (
        usos.some(
          (u) =>
            ts.isReturnStatement(sinEnvoltorio(u).parent) ||
            (ts.isCallExpression(sinEnvoltorio(u).parent) &&
              sinEnvoltorio(u).parent.arguments.includes(sinEnvoltorio(u)))
        )
      )
        return { clase: 'HUECO', como: 'la respuesta entera pasa a otro sitio' }
      return { clase: 'NO_MIRA', como: 'variable sin leer .error' }
    }
    return { clase: 'HUECO', como: 'patrón de array' }
  }

  // Qué se hace con el valor ya esperado (`await x`).
  const tras = (aw) => {
    const n = sinEnvoltorio(aw)
    const p = n.parent
    if (ts.isVariableDeclaration(p) && p.initializer === n) return deLaVinculacion(p.name)
    if (ts.isExpressionStatement(p)) return { clase: 'NO_MIRA', como: 'resultado tirado' }
    if (ts.isReturnStatement(p) || (ts.isArrowFunction(p) && p.body === n))
      return { clase: 'PASA', como: 'return' }
    if (ts.isPropertyAccessExpression(p) && p.expression === n)
      return p.name.text === 'error'
        ? { clase: 'MIRA', como: '(await …).error' }
        : { clase: 'NO_MIRA', como: `(await …).${p.name.text}` }
    if (
      ts.isBinaryExpression(p) &&
      p.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      p.right === n
    )
      return { clase: 'HUECO', como: 'asignación' }
    return { clase: 'HUECO', como: ts.SyntaxKind[p.kind] }
  }

  // El elemento i de un `await Promise.all([…])` desestructurado.
  const enPromiseAll = (n) => {
    const arr = n.parent
    if (!ts.isArrayLiteralExpression(arr)) return null
    const call = arr.parent
    if (
      !ts.isCallExpression(call) ||
      call.expression.getText() !== 'Promise.all' ||
      call.arguments[0] !== arr
    )
      return null
    const aw = sinEnvoltorio(call).parent
    if (!ts.isAwaitExpression(aw)) return { clase: 'HUECO', como: 'Promise.all sin await' }
    const decl = sinEnvoltorio(aw).parent
    if (!ts.isVariableDeclaration(decl) || !ts.isArrayBindingPattern(decl.name))
      return { clase: 'HUECO', como: 'Promise.all sin desestructurar' }
    const el = decl.name.elements[arr.elements.indexOf(n)]
    if (!el || ts.isOmittedExpression(el))
      return { clase: 'NO_MIRA', como: 'Promise.all, elemento omitido' }
    return deLaVinculacion(el.name)
  }

  const consumo = (call) => {
    const n = subeEncadenado(call)
    const p = n.parent
    if (ts.isAwaitExpression(p)) return tras(p)
    if (ts.isReturnStatement(p) || (ts.isArrowFunction(p) && p.body === n))
      return { clase: 'PASA', como: 'return del constructor' }
    const pa = enPromiseAll(n)
    if (pa) return pa
    if (ts.isVariableDeclaration(p) && p.initializer === n && ts.isIdentifier(p.name)) {
      // Un constructor guardado en una variable: cada `await` sobre ella (tras su encadenado) es el consumo.
      const r = []
      for (const u of usosDe(p.name)) {
        const top = subeEncadenado(u)
        if (ts.isAwaitExpression(top.parent)) r.push(tras(top.parent))
        else if (
          ts.isBinaryExpression(top.parent) &&
          top.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
        )
          continue // q = q.eq(…): sigue siendo el constructor
        else if (ts.isReturnStatement(top.parent))
          r.push({ clase: 'PASA', como: 'return de la variable' })
        else if (top !== u || !ts.isBinaryExpression(u.parent)) {
          const pa2 = enPromiseAll(top)
          r.push(
            pa2 ?? { clase: 'HUECO', como: 'variable usada como ' + ts.SyntaxKind[top.parent.kind] }
          )
        }
      }
      if (!r.length) return { clase: 'HUECO', como: 'variable sin await' }
      const peor =
        r.find((x) => x.clase === 'NO_MIRA') ?? r.find((x) => x.clase === 'HUECO') ?? r[0]
      return { ...peor, como: 'variable · ' + peor.como }
    }
    if (ts.isPropertyAccessExpression(p) && p.name.text === 'then')
      return { clase: 'HUECO', como: '.then' }
    if (ts.isCallExpression(p) && p.arguments.includes(n))
      return { clase: 'HUECO', como: 'argumento' }
    return { clase: 'HUECO', como: ts.SyntaxKind[p.kind] }
  }

  // 2. Los sitios: cada llamada que el checker resuelve a un helper de la clase.
  const sitios = []
  let sinResolver = 0
  for (const sf of fuentes) {
    const visitar = (n) => {
      if (ts.isCallExpression(n)) {
        const sig = checker.getResolvedSignature(n)
        const d = sig && sig.declaration
        if (!d) {
          // Las llamadas que el checker no resuelve: solo cuentan si su tipo es de la clase.
          const t = checker.getTypeAtLocation(n)
          if (esBuilder(t) || esRespuesta(t)) sinResolver++
        } else if (helpers.has(d)) {
          const h = helpers.get(d)
          sitios.push({
            donde: donde(n),
            helper: h.nombre,
            helperEn: h.donde,
            tipo: h.tipo,
            ...consumo(n),
          })
        }
      }
      ts.forEachChild(n, visitar)
    }
    visitar(sf)
  }
  return {
    helpers: [...helpers.values()],
    anonimas,
    sitios,
    sinResolver,
  }
}

module.exports = { analizar }

if (require.main === module) {
  const raiz = path.resolve(__dirname, '..', '..')
  const t0 = Date.now()
  const r = analizar(raiz)
  const cuenta = {}
  for (const s of r.sitios) cuenta[s.clase] = (cuenta[s.clase] ?? 0) + 1
  console.log(
    `anónimas ${r.anonimas.length} · helpers de la clase ${r.helpers.length} (builder ${r.helpers.filter((h) => h.tipo === 'builder').length}, respuesta ${r.helpers.filter((h) => h.tipo === 'respuesta').length}) · sitios ${r.sitios.length} · ${JSON.stringify(cuenta)} · llamadas sin resolver de la clase ${r.sinResolver} · ${Math.round((Date.now() - t0) / 1000)} s`
  )
  for (const h of r.helpers) console.log(`  helper  ${h.donde}  ${h.nombre} (${h.tipo})`)
  for (const a of r.anonimas) console.log(`  ANÓNIMA ${a.donde}  (${a.tipo}, dentro de ${a.en})`)
  for (const s of r.sitios.filter((s) => s.clase !== 'MIRA' && s.clase !== 'PASA'))
    console.log(
      `  ${s.clase.padEnd(7)} ${s.donde}  ${s.helper} (${s.tipo}, ${s.helperEn}) · ${s.como}`
    )
  const i = process.argv.indexOf('--informe')
  if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(r, null, 1))
}
