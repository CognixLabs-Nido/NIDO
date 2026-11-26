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
// Uso:  node scripts/ci/fallo-que-se-pierde.cjs [--informe f.json] [--check]
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

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // CLASE 1 · EL HELPER QUE AVISA DEL FALLO Y EL LLAMADOR QUE NO LO USA. Un helper AVISA si alguno de sus
  // `return` está en un CAMINO DE FALLO y lo que devuelve allí se distingue, por el TIPO, de lo que devuelve
  // por el camino bueno:
  //   CAMINO DE FALLO  dentro del `then` de un `if` cuya condición usa un valor de tipo `PostgrestError`
  //                    (o del `else` de un `if (!error)`), o el centinela de otro helper que avisa (punto
  //                    fijo), o dentro de un `catch`.
  //   CENTINELA        `null` o `undefined` que el camino bueno NO puede devolver (si puede, el helper ya
  //                    colapsa el fallo él solo: es F1/F2 del censo, se cuenta aparte como COLAPSA); o una
  //                    BANDERA: una propiedad de tipo literal `false` en el fallo que en el camino bueno no
  //                    es `false` (`leidos`, `ok`, `success`…).
  // Y cada llamada a un helper que avisa: USA (lee la bandera; distingue el centinela: si el helper devuelve
  // `null` Y `undefined`, solo `=== null`/`!== null` lo distingue, `!x` los junta), NO_USA, PASA (`return`:
  // quien lo hace es a su vez un helper que avisa, punto fijo) o HUECO (otra forma; se cuenta y se lista).
  const tipoDe = (n) => checker.getTypeAtLocation(n)
  const esErrorPostgrest = (t) =>
    miembros(t).some((m) => {
      const s = m.getSymbol() || m.aliasSymbol
      return (
        !!s &&
        /^(PostgrestError|StorageError|StorageApiError|StorageUnknownError|AuthError|AuthApiError|FunctionsError|FunctionsHttpError)$/.test(
          s.getName()
        )
      )
    })
  const tiene = (t, flag) => miembros(esperado(t)).some((m) => m.flags & flag)
  const puedeNull = (t) => tiene(t, ts.TypeFlags.Null)
  const puedeUndef = (t) => tiene(t, ts.TypeFlags.Undefined | ts.TypeFlags.Void)
  const literalFalse = (t) =>
    miembros(t).length > 0 &&
    miembros(t).every(
      (m) => m.flags & ts.TypeFlags.BooleanLiteral && checker.typeToString(m) === 'false'
    )

  const avisan = new Map() // declaración → { centinelas:Set('null'|'undefined'), banderas:Set }
  const colapsan = []
  const fnDe = (n) => {
    let p = n.parent
    while (p && !ts.isFunctionLike(p)) p = p.parent
    return p
  }
  // ¿Esta expresión, en una condición, es una señal de fallo? (lee un PostgrestError, o el centinela o la
  // bandera de un helper que avisa).
  const llamadaQueAvisa = (e) => {
    // e: un identificador ligado a `await h()` (o `h()`), o una propiedad de él
    const sym = checker.getSymbolAtLocation(e)
    const d = sym && sym.valueDeclaration
    if (!d) return null
    let init = null
    if (ts.isVariableDeclaration(d)) init = d.initializer
    else if (ts.isBindingElement(d)) {
      let p = d.parent
      while (p && !ts.isVariableDeclaration(p)) p = p.parent
      init = p && p.initializer
    }
    if (!init) return null
    let x = init
    while (ts.isAwaitExpression(x) || ts.isParenthesizedExpression(x)) x = x.expression
    if (!ts.isCallExpression(x)) return null
    const sig = checker.getResolvedSignature(x)
    return sig && sig.declaration && avisan.has(sig.declaration)
      ? avisan.get(sig.declaration)
      : null
  }
  const esSenal = (cond) => {
    let si = false
    const v = (n) => {
      if (si) return
      if (ts.isIdentifier(n) || ts.isPropertyAccessExpression(n)) {
        try {
          if (esErrorPostgrest(tipoDe(n))) si = true
        } catch {}
        if (!si && ts.isIdentifier(n) && llamadaQueAvisa(n)) si = true
        if (!si && ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression)) {
          const a = llamadaQueAvisa(n.expression)
          if (a && a.banderas.has(n.name.text)) si = true
        }
      }
      if (!si) ts.forEachChild(n, v)
    }
    v(cond)
    return si
  }
  const negada = (c) =>
    ts.isPrefixUnaryExpression(c) && c.operator === ts.SyntaxKind.ExclamationToken
  const enCaminoDeFallo = (ret, fn) => {
    let n = ret
    while (n && n !== fn) {
      const p = n.parent
      if (ts.isCatchClause(p)) return true
      if (ts.isIfStatement(p) && n !== p.expression && esSenal(p.expression)) {
        const enThen = p.thenStatement === n
        return negada(p.expression) && !ts.isPrefixUnaryExpression(p.expression.operand)
          ? !enThen
          : enThen
      }
      n = p
    }
    return false
  }
  const retornos = (fn) => {
    const rs = []
    const v = (n) => {
      if (n !== fn && ts.isFunctionLike(n)) return
      if (ts.isReturnStatement(n)) rs.push(n)
      ts.forEachChild(n, v)
    }
    if (fn.body && ts.isBlock(fn.body)) v(fn.body)
    return rs
  }
  const centinelaDe = (ret) => {
    const e = ret.expression
    if (!e || (ts.isIdentifier(e) && e.text === 'undefined')) return 'undefined'
    if (e.kind === ts.SyntaxKind.NullKeyword) return 'null'
    return null
  }
  const banderasFalse = (t) => {
    const r = new Set()
    for (const m of miembros(esperado(t)))
      for (const p of m.getProperties()) {
        const pt = checker.getTypeOfSymbol(p)
        if (literalFalse(pt)) r.add(p.getName())
      }
    return r
  }
  const todasLasFunciones = []
  for (const sf of fuentes) {
    const v = (n) => {
      if (ts.isFunctionLike(n) && n.body && ts.isBlock(n.body)) todasLasFunciones.push(n)
      ts.forEachChild(n, v)
    }
    v(sf)
  }
  // Punto fijo: una función avisa por sus propios caminos de fallo, que pueden depender de otros que avisan.
  for (let cambio = true, vuelta = 0; cambio && vuelta < 10; vuelta++) {
    cambio = false
    for (const fn of todasLasFunciones) {
      if (avisan.has(fn)) continue
      const rs = retornos(fn)
      const fallo = rs.filter((r) => enCaminoDeFallo(r, fn))
      if (!fallo.length) continue
      const bueno = rs.filter((r) => !fallo.includes(r))
      const tBueno = bueno.filter((r) => r.expression).map((r) => tipoDe(r.expression))
      const centinelas = new Set()
      const banderas = new Set()
      let colapsa = false
      for (const r of fallo) {
        const c = centinelaDe(r)
        if (c === 'null') {
          if (tBueno.some(puedeNull) || bueno.some((b) => centinelaDe(b) === 'null')) colapsa = true
          else centinelas.add('null')
        } else if (c === 'undefined') {
          if (tBueno.some(puedeUndef) || bueno.some((b) => !b.expression)) colapsa = true
          else centinelas.add('undefined')
        } else if (r.expression) {
          for (const p of banderasFalse(tipoDe(r.expression))) {
            // la bandera solo avisa si en el camino bueno NO es siempre false
            const enBueno = tBueno.every((t) =>
              miembros(esperado(t)).every((m) => {
                const s = m.getProperty(p)
                return !s || literalFalse(checker.getTypeOfSymbol(s))
              })
            )
            if (!enBueno && bueno.length) banderas.add(p)
          }
        }
      }
      if (centinelas.size || banderas.size) {
        avisan.set(fn, { centinelas, banderas, donde: donde(fn), nombre: nombreDe(fn) })
        cambio = true
      } else if (colapsa && !colapsan.some((c) => c.fn === fn))
        colapsan.push({ fn, donde: donde(fn), nombre: nombreDe(fn) })
    }
  }

  // Los llamadores.
  const usoDeVinculo = (nombre, a) => {
    // nombre: Identifier o ObjectBindingPattern del resultado esperado
    if (ts.isObjectBindingPattern(nombre)) {
      if (!a.banderas.size) return { clase: 'HUECO', como: 'desestructura un centinela' }
      const usadas = nombre.elements.filter((e) => {
        const k = e.propertyName ? e.propertyName.getText() : e.name.getText()
        return a.banderas.has(k) && ts.isIdentifier(e.name) && usosDe(e.name).length > 0
      })
      return usadas.length
        ? { clase: 'USA', como: 'lee ' + usadas.map((e) => e.name.getText()).join(',') }
        : { clase: 'NO_USA', como: 'desestructura sin ' + [...a.banderas].join('/') }
    }
    if (!ts.isIdentifier(nombre)) return { clase: 'HUECO', como: 'patrón de array' }
    const usos = usosDe(nombre)
    if (a.banderas.size) {
      if (
        usos.some(
          (u) => ts.isPropertyAccessExpression(u.parent) && a.banderas.has(u.parent.name.text)
        )
      )
        return { clase: 'USA', como: 'lee la bandera' }
    }
    if (a.centinelas.size) {
      const ambos = a.centinelas.size === 2 || false
      const estricto = (u) => {
        const p = sinEnvoltorio(u).parent
        return (
          ts.isBinaryExpression(p) &&
          [
            ts.SyntaxKind.EqualsEqualsEqualsToken,
            ts.SyntaxKind.ExclamationEqualsEqualsToken,
          ].includes(p.operatorToken.kind) &&
          [p.left, p.right].some(
            (x) =>
              x.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(x) && x.text === 'undefined')
          )
        )
      }
      const laxo = (u) => {
        const p = sinEnvoltorio(u).parent
        return (
          (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) ||
          (ts.isIfStatement(p) && p.expression === sinEnvoltorio(u)) ||
          (ts.isBinaryExpression(p) &&
            [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(
              p.operatorToken.kind
            )) ||
          (ts.isBinaryExpression(p) &&
            p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
            p.left === sinEnvoltorio(u)) ||
          (ts.isConditionalExpression(p) && p.condition === sinEnvoltorio(u))
        )
      }
      // ¿Puede el camino bueno devolver el OTRO falsy (undefined = «no le toca»)? Entonces `!x` junta los dos.
      const otroFalsy = a.otroFalsy
      if (usos.some(estricto)) return { clase: 'USA', como: 'compara estricto' }
      if (usos.some(laxo))
        return otroFalsy
          ? { clase: 'NO_USA', como: '!x junta el fallo con ' + otroFalsy }
          : { clase: 'USA', como: 'comprueba el centinela' }
    }
    if (usos.some((u) => ts.isReturnStatement(sinEnvoltorio(u).parent)))
      return { clase: 'PASA', como: 'return' }
    // `x?.a` o `x ?? defecto`: degrada a propósito o colapsa; se juzga a mano (DEGRADA).
    if (
      usos.some((u) => {
        const q = sinEnvoltorio(u).parent
        return (
          (ts.isPropertyAccessExpression(q) && q.questionDotToken) ||
          (ts.isBinaryExpression(q) &&
            q.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
            q.left === sinEnvoltorio(u))
        )
      })
    )
      return { clase: 'DEGRADA', como: '?. o ??' }
    if (
      usos.some(
        (u) =>
          ts.isJsxExpression(sinEnvoltorio(u).parent) ||
          ts.isJsxAttribute(sinEnvoltorio(u).parent?.parent)
      )
    )
      return { clase: 'HUECO', como: 'prop de JSX' }
    if (
      usos.some((u) => {
        const p = sinEnvoltorio(u).parent
        return ts.isCallExpression(p) && p.arguments.includes(sinEnvoltorio(u))
      })
    )
      return { clase: 'HUECO', como: 'pasa a otra función' }
    return { clase: 'NO_USA', como: 'no mira ' + [...a.banderas, ...a.centinelas].join('/') }
  }
  // el «otro falsy» del camino bueno: undefined si el bueno puede devolverlo y el centinela es null, etc.
  for (const [fn, a] of avisan) {
    const rs = retornos(fn).filter((r) => !enCaminoDeFallo(r, fn))
    const ts_ = rs.filter((r) => r.expression).map((r) => tipoDe(r.expression))
    a.otroFalsy =
      a.centinelas.has('null') &&
      !a.centinelas.has('undefined') &&
      (ts_.some(puedeUndef) || rs.some((r) => !r.expression || centinelaDe(r) === 'undefined'))
        ? 'undefined («no le toca»)'
        : null
  }
  const sitios1 = []
  for (const sf of fuentes) {
    const v = (n) => {
      if (ts.isCallExpression(n)) {
        const sig = checker.getResolvedSignature(n)
        const d = sig && sig.declaration
        if (d && avisan.has(d)) {
          const a = avisan.get(d)
          let top = sinEnvoltorio(n)
          let p = top.parent
          if (ts.isAwaitExpression(p)) {
            top = sinEnvoltorio(p)
            p = top.parent
          }
          let r
          if (ts.isVoidExpression(p)) r = { clase: 'HUECO', como: 'sin esperar (void)' }
          else if (
            ts.isPropertyAccessExpression(p) &&
            p.expression === top &&
            ['then', 'catch', 'finally'].includes(p.name.text)
          )
            r = { clase: 'HUECO', como: `sin esperar (.${p.name.text})` }
          else if (ts.isPropertyAccessExpression(p) && p.expression === top && p.questionDotToken)
            r = { clase: 'DEGRADA', como: `(…)?.${p.name.text}` }
          else if (ts.isVariableDeclaration(p) && p.initializer === top) r = usoDeVinculo(p.name, a)
          else if (ts.isReturnStatement(p) || (ts.isArrowFunction(p) && p.body === top))
            r = { clase: 'PASA', como: 'return' }
          else if (ts.isExpressionStatement(p)) r = { clase: 'NO_USA', como: 'resultado tirado' }
          else if (ts.isPropertyAccessExpression(p) && p.expression === top)
            r = a.banderas.has(p.name.text)
              ? { clase: 'USA', como: `.${p.name.text}` }
              : { clase: 'NO_USA', como: `.${p.name.text}` }
          else if (ts.isArrayLiteralExpression(p)) {
            // Promise.all([...]) desestructurado
            const call = p.parent
            const aw = call && sinEnvoltorio(call).parent
            const decl = aw && ts.isAwaitExpression(aw) && sinEnvoltorio(aw).parent
            if (decl && ts.isVariableDeclaration(decl) && ts.isArrayBindingPattern(decl.name)) {
              const el = decl.name.elements[p.elements.indexOf(top)]
              r =
                !el || ts.isOmittedExpression(el)
                  ? { clase: 'NO_USA', como: 'Promise.all, omitido' }
                  : usoDeVinculo(el.name, a)
            } else r = { clase: 'HUECO', como: 'array' }
          } else r = { clase: 'HUECO', como: ts.SyntaxKind[p.kind] }
          sitios1.push({
            donde: donde(n),
            helper: a.nombre,
            helperEn: a.donde,
            avisa: [...a.centinelas, ...a.banderas].join('/'),
            ...r,
          })
        }
      }
      ts.forEachChild(n, v)
    }
    v(sf)
  }
  const clase1 = {
    helpers: [...avisan.values()].map((a) => ({
      donde: a.donde,
      nombre: a.nombre,
      avisa: [...a.centinelas, ...a.banderas],
      otroFalsy: a.otroFalsy,
    })),
    colapsan: colapsan.map((c) => ({ donde: c.donde, nombre: c.nombre })),
    sitios: sitios1,
  }

  return {
    helpers: [...helpers.values()],
    anonimas,
    sitios,
    sinResolver,
    clase1,
  }
}

/**
 * Lo que la CI exige (censo C, 2026-11-26): ningún NO_MIRA (clase 2) ni NO_USA (clase 1) fuera de la lista
 * (`fallo-que-se-pierde.lista.json`, cada clave con su número y su motivo). Clave `fichero|helper|clase`, no la
 * línea, que se mueve con cualquier cambio. Como la de cadena, la lista solo encoge: si un fichero tiene MENOS
 * de los que admite, también es rojo, para bajarla (y que no quede hueco para uno nuevo con el patrón viejo).
 */
function clave(s) {
  return `${s.donde.replace(/:\d+$/, '')}|${s.helper}|${s.clase}`
}
function comprobar(r, lista) {
  const hay = {}
  for (const s of [...r.sitios, ...r.clase1.sitios])
    if (s.clase === 'NO_MIRA' || s.clase === 'NO_USA') hay[clave(s)] = (hay[clave(s)] ?? 0) + 1
  const nuevas = []
  const sobran = []
  for (const [k, n] of Object.entries(hay)) {
    const admite = lista[k]?.n ?? 0
    if (n > admite) nuevas.push({ clave: k, hay: n, admite })
  }
  for (const [k, v] of Object.entries(lista)) {
    const n = hay[k] ?? 0
    if (n < v.n) sobran.push({ clave: k, hay: n, admite: v.n })
  }
  return { nuevas, sobran }
}

module.exports = { analizar, comprobar, clave }

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
  const c1 = r.clase1
  const k1 = {}
  for (const s of c1.sitios) k1[s.clase] = (k1[s.clase] ?? 0) + 1
  console.log(
    `CLASE 1 · helpers que avisan ${c1.helpers.length} · colapsan dentro ${c1.colapsan.length} · sitios ${c1.sitios.length} · ${JSON.stringify(k1)}`
  )
  for (const s of c1.sitios.filter((s) => s.clase !== 'USA' && s.clase !== 'PASA'))
    console.log(
      `  ${s.clase.padEnd(7)} ${s.donde}  ${s.helper} (avisa ${s.avisa}, ${s.helperEn}) · ${s.como}`
    )
  const i = process.argv.indexOf('--informe')
  if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(r, null, 1))
  if (process.argv.includes('--check')) {
    const lista = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'fallo-que-se-pierde.lista.json'), 'utf8')
    )
    const { nuevas, sobran } = comprobar(r, lista)
    for (const x of nuevas)
      console.log(
        `  NUEVO (un fallo que se pierde): ${x.clave} · hay ${x.hay}, la lista admite ${x.admite}`
      )
    for (const x of sobran)
      console.log(
        `  SOBRA en la lista (hay ${x.hay}, admite ${x.admite}: bájala, la lista solo encoge): ${x.clave}`
      )
    if (nuevas.length || sobran.length) process.exit(1)
    console.log('OK')
  }
}
