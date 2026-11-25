#!/usr/bin/env node
// Codemod del censo C (decisión de Jose del 2026-11-25): «una lectura que falló no es "no hay"».
//
// Entrada: una lista de sitios {f, l, helper, molde, destino} (los del censo, con su línea), y la raíz del
// repo. Para cada sitio busca la llamada `.from(…)`/`.rpc(…)` que empieza en esa línea, sube hasta quien
// consume el resultado y:
//   · molde A (no mira el error): destructura `error` (o usa `r.error`) e inserta, justo después de la
//     sentencia, `if (<error>) throw new LecturaFallida('<helper>', <error>)` —o, en una acción
//     (`destino: 'fail'`), `if (<error>) return fail('common.lectura_fallida')`—;
//   · molde B (mira el error, lo loguea y devuelve un vacío): cambia ese `return <vacío>` por el mismo
//     throw o fail. Solo si la condición del `if` es EXACTAMENTE el error: con `error || !data`, el no-hay
//     también lanzaría, y eso sería cambiar lo que no toca.
// Lo que no encaja (la llamada no está, la consumen de otra forma, una acción sin `fail` o que no devuelve
// ActionResult, un `if` con otra condición) se APARTA con su motivo: no se toca.
//
// AUTOCOMPROBACIÓN, fichero a fichero (la condición de Jose): se quitan del árbol nuevo exactamente las
// piezas insertadas (los `if` nuevos, las `error: …` añadidas, el import) y se igualan los `return` del
// molde B; el árbol que queda, impreso, tiene que ser IDÉNTICO al original impreso. Si no, ese fichero no
// se escribe y el codemod sale con error.
//
// Uso: node scripts/codemods/lectura-mira-el-error.cjs <entrada.json> <salida-informe.json> [--escribir]
const path = require('path')
const fs = require('fs')
const raiz = process.cwd()
const ts = require(path.join(raiz, 'node_modules/typescript'))

const [entrada, informePath, ...resto] = process.argv.slice(2)
const ESCRIBIR = resto.includes('--escribir')
// --salida <dir>: escribe el resultado en otra carpeta (los casos del propio codemod).
const SALIDA = resto.includes('--salida') ? resto[resto.indexOf('--salida') + 1] : null
// Control negativo de la autocomprobación: CODEMOD_ROMPER=1 cambia además algo que NO debía (un literal
// 0 → 1 en la primera sentencia del fichero que lo tenga); la autocomprobación tiene que pararlo.
const ROMPER = process.env.CODEMOD_ROMPER === '1'
const sitios = JSON.parse(fs.readFileSync(entrada, 'utf8'))

const IMPORT = "import { LecturaFallida } from '@/shared/lib/lectura-fallida'"
const CLAVE_FAIL = 'common.lectura_fallida'

const porFichero = new Map()
for (const s of sitios) porFichero.set(s.f, [...(porFichero.get(s.f) ?? []), s])

const informe = { aplicados: [], apartados: [], ficheros: [], fallosAutocomprobacion: [] }

function crear(f, texto) {
  return ts.createSourceFile(
    f,
    texto,
    ts.ScriptTarget.Latest,
    true,
    f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
}
const linea = (src, n) => src.getLineAndCharacterOfPosition(n.getStart()).line + 1

function llamadaEn(src, l) {
  let hallada = null
  const ver = (n) => {
    if (hallada) return
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const m = n.expression.name.text
      const obj = n.expression.expression.getText()
      const esLectura =
        m === 'rpc' ||
        (m === 'from' && !/storage$/.test(obj) && n.arguments.length === 1) ||
        (m === 'from' && /storage$/.test(obj))
      if (esLectura && linea(src, n) === l) {
        hallada = n
        return
      }
    }
    ts.forEachChild(n, ver)
  }
  ver(src)
  return hallada
}

function topeCadena(n) {
  let cur = n
  for (;;) {
    const p = cur.parent
    if (
      p &&
      ts.isPropertyAccessExpression(p) &&
      p.expression === cur &&
      p.parent &&
      ts.isCallExpression(p.parent) &&
      p.parent.expression === p
    ) {
      cur = p.parent
      continue
    }
    return cur
  }
}

// Sube hasta quien consume: la declaración (var) o el elemento de un Promise.all destructurado.
function consumo(tope) {
  let cur = tope
  let awaited = false
  for (;;) {
    const p = cur.parent
    if (!p) return null
    if (ts.isAwaitExpression(p)) awaited = true
    if (ts.isAwaitExpression(p) || ts.isParenthesizedExpression(p) || ts.isAsExpression(p)) {
      cur = p
      continue
    }
    // Sin await, la variable guarda la CONSULTA (un builder al que luego se le añaden filtros), no su
    // resultado: ahí no hay `error` que mirar (lo cazó el typecheck en 4 sitios). Se aparta.
    if (ts.isVariableDeclaration(p) && p.initializer === cur)
      return awaited ? { tipo: 'var', decl: p, nombre: p.name } : null
    if (ts.isArrayLiteralExpression(p)) {
      const call = p.parent
      if (call && ts.isCallExpression(call) && /^Promise\.all$/.test(call.expression.getText())) {
        let q = call
        while (
          q.parent &&
          (ts.isAwaitExpression(q.parent) || ts.isParenthesizedExpression(q.parent))
        )
          q = q.parent
        const d = q.parent
        if (d && ts.isVariableDeclaration(d) && ts.isArrayBindingPattern(d.name)) {
          const el = d.name.elements[p.elements.indexOf(cur)]
          if (el && ts.isBindingElement(el))
            return { tipo: 'promise_all', decl: d, nombre: el.name }
        }
      }
      return null
    }
    return null
  }
}

function sentenciaDe(decl) {
  const vs = decl.parent && decl.parent.parent
  if (
    vs &&
    ts.isVariableStatement(vs) &&
    vs.parent &&
    (ts.isBlock(vs.parent) || ts.isSourceFile(vs.parent))
  )
    return vs
  return null
}

function funcionDe(n) {
  let c = n.parent
  while (c && !ts.isFunctionLike(c)) c = c.parent
  return c
}

function nombresUsados(nodo) {
  const s = new Set()
  const v = (x) => {
    if (ts.isIdentifier(x)) s.add(x.text)
    ts.forEachChild(x, v)
  }
  v(nodo)
  return s
}

function importaFail(src) {
  return (
    src.statements.some(
      (st) =>
        ts.isImportDeclaration(st) &&
        st.importClause &&
        st.importClause.namedBindings &&
        ts.isNamedImports(st.importClause.namedBindings) &&
        st.importClause.namedBindings.elements.some((e) => e.name.text === 'fail')
    ) ||
    src.statements.some((st) => ts.isFunctionDeclaration(st) && st.name && st.name.text === 'fail')
  )
}

function procesar(f, lista) {
  const original = fs.readFileSync(path.join(raiz, f), 'utf8')
  const src = crear(f, original)
  const ediciones = [] // {pos, borrar, texto}
  const retornosB = [] // posiciones (en el original) de los return del molde B
  let usaThrow = false
  const yaInsertado = new Set()
  const usadosPorFn = new Map()

  for (const s of lista) {
    const apartar = (motivo) => informe.apartados.push({ ...s, motivo })
    const call = llamadaEn(src, s.l)
    if (!call) {
      apartar('la llamada no está en esa línea')
      continue
    }
    const c = consumo(topeCadena(call))
    if (!c) {
      apartar('se consume de otra forma')
      continue
    }
    const st = sentenciaDe(c.decl)
    if (!st) {
      apartar('la declaración no es una sentencia de un bloque')
      continue
    }
    const fn = funcionDe(st)
    if (s.destino === 'fail') {
      const tipoRet = fn && fn.type ? fn.type.getText() : ''
      if (!importaFail(src) || !/ActionResult/.test(tipoRet)) {
        apartar('acción sin fail o que no devuelve ActionResult')
        continue
      }
    }
    // Los nombres usados se recuerdan POR FUNCIÓN entre sitios: dos lecturas de un Promise.all no pueden
    // acabar las dos con `error` (lo cazó el caso aPromiseAll).
    const claveFn = fn ?? src
    if (!usadosPorFn.has(claveFn))
      usadosPorFn.set(claveFn, fn ? nombresUsados(fn) : nombresUsados(src))
    const usados = usadosPorFn.get(claveFn)

    // El nombre del error.
    let errExpr = null
    if (ts.isObjectBindingPattern(c.nombre)) {
      const el = c.nombre.elements.find((e) => (e.propertyName || e.name).getText() === 'error')
      if (el) errExpr = el.name.getText()
      else {
        if (s.molde !== 'A') {
          apartar('molde B sin error destructurado')
          continue
        }
        let prop
        if (!usados.has('error')) {
          prop = 'error'
          errExpr = 'error'
        } else {
          let n = 'errorLectura',
            i = 2
          while (usados.has(n)) n = `errorLectura${i++}`
          prop = `error: ${n}`
          errExpr = n
        }
        usados.add(errExpr)
        const ult = c.nombre.elements[c.nombre.elements.length - 1]
        ediciones.push({ pos: ult.getEnd(), borrar: 0, texto: `, ${prop}` })
      }
    } else if (ts.isIdentifier(c.nombre)) {
      errExpr = `${c.nombre.text}.error`
    } else {
      apartar('patrón de destructuración desconocido')
      continue
    }

    const accion =
      s.destino === 'fail'
        ? `return fail('${CLAVE_FAIL}')`
        : `throw new LecturaFallida('${s.helper.replace(/'/g, '')}', ${errExpr})`
    if (s.destino !== 'fail') usaThrow = true

    if (s.molde === 'A') {
      const clave = `${st.getEnd()}|${errExpr}`
      if (yaInsertado.has(clave)) {
        informe.aplicados.push({ ...s, como: 'ya cubierto por otro sitio' })
        continue
      }
      yaInsertado.add(clave)
      const indent = original
        .slice(original.lastIndexOf('\n', st.getStart()) + 1, st.getStart())
        .match(/^\s*/)[0]
      ediciones.push({ pos: st.getEnd(), borrar: 0, texto: `\n${indent}if (${errExpr}) ${accion}` })
      informe.aplicados.push({ ...s, como: 'A: if insertado' })
    } else {
      // Molde B: el primer if después de la sentencia cuya condición es exactamente el error.
      const cuerpo = st.parent
      const i = cuerpo.statements.indexOf(st)
      const sig = cuerpo.statements
        .slice(i + 1)
        .find((x) => ts.isIfStatement(x) && x.expression.getText() === errExpr)
      if (!sig) {
        apartar('molde B: no hay if (error) con esa condición exacta')
        continue
      }
      const then = sig.thenStatement
      const sts = ts.isBlock(then) ? then.statements : [then]
      const ret = sts[sts.length - 1]
      const resto = sts.slice(0, -1)
      if (
        !ret ||
        !ts.isReturnStatement(ret) ||
        sig.elseStatement ||
        !resto.every(
          (x) =>
            ts.isExpressionStatement(x) &&
            /^(logger\.\w+|console\.\w+)\(/.test(x.expression.getText())
        )
      ) {
        apartar('molde B: el if hace algo más que loguear y devolver')
        continue
      }
      ediciones.push({ pos: ret.getStart(), borrar: ret.getEnd() - ret.getStart(), texto: accion })
      retornosB.push(ret.getStart())
      informe.aplicados.push({ ...s, como: 'B: return cambiado' })
    }
  }

  if (!ediciones.length) return
  // Dos `if` en el mismo punto (un Promise.all con dos lecturas): una sola inserción, uno detrás de otro.
  for (let i = 0; i < ediciones.length; i++)
    for (let j = ediciones.length - 1; j > i; j--)
      if (
        ediciones[j].pos === ediciones[i].pos &&
        !ediciones[i].borrar &&
        !ediciones[j].borrar &&
        ediciones[i].texto.startsWith('\n') &&
        ediciones[j].texto.startsWith('\n')
      ) {
        ediciones[i] = {
          ...ediciones[i],
          partes: [...(ediciones[i].partes ?? [ediciones[i].texto]), ediciones[j].texto],
          texto: ediciones[i].texto + ediciones[j].texto,
        }
        ediciones.splice(j, 1)
      }
  let nuevo = original
  for (const e of [...ediciones].sort((a, b) => b.pos - a.pos))
    nuevo = nuevo.slice(0, e.pos) + e.texto + nuevo.slice(e.pos + e.borrar)
  // Dónde acaba cada edición en el texto nuevo: su posición más lo que crecieron las de antes.
  const finalDe = (e) =>
    e.pos +
    ediciones.filter((o) => o.pos < e.pos).reduce((t, o) => t + o.texto.length - o.borrar, 0)
  let desplazamientoImport = 0,
    posImport = Infinity
  if (usaThrow && !nuevo.includes(IMPORT)) {
    const imps = crear(f, nuevo).statements.filter(ts.isImportDeclaration)
    const fin = imps.length
      ? imps[imps.length - 1].getEnd()
      : nuevo.startsWith("'use")
        ? nuevo.indexOf('\n')
        : 0
    nuevo = nuevo.slice(0, fin) + `\n${IMPORT}\n` + nuevo.slice(fin)
    posImport = fin
    desplazamientoImport = IMPORT.length + 2
  }
  const enNuevo = (x) => (x >= posImport ? x + desplazamientoImport : x)
  const posInsertados = new Set()
  for (const e of ediciones.filter((x) => x.texto.startsWith('\n'))) {
    let off = 0
    for (const parte of e.partes ?? [e.texto]) {
      posInsertados.add(enNuevo(finalDe(e) + off + parte.indexOf('if (')))
      off += parte.length
    }
  }
  const posAnadidas = new Set(
    ediciones.filter((e) => e.texto.startsWith(', ')).map((e) => enNuevo(finalDe(e) + 2))
  )
  const posB = new Set(ediciones.filter((e) => e.borrar > 0).map((e) => enNuevo(finalDe(e))))

  if (ROMPER) nuevo = nuevo.replace(/= 0\b/, '= 1')
  // ---- Autocomprobación ----
  const imprimir = (sf) => ts.createPrinter({ removeComments: true }).printFile(sf)
  const esInsertado = (n) =>
    ts.isIfStatement(n) &&
    !n.elseStatement &&
    ((ts.isThrowStatement(n.thenStatement) &&
      /^new LecturaFallida\(/.test(n.thenStatement.expression.getText())) ||
      (ts.isReturnStatement(n.thenStatement) &&
        n.thenStatement.expression &&
        n.thenStatement.expression.getText() === `fail('${CLAVE_FAIL}')`))
  const esB = (n) =>
    (ts.isThrowStatement(n) && /^new LecturaFallida\(/.test(n.expression.getText())) ||
    (ts.isReturnStatement(n) && n.expression && n.expression.getText() === `fail('${CLAVE_FAIL}')`)
  const marca = () => ts.factory.createReturnStatement(ts.factory.createIdentifier('__MOLDE_B__'))
  const srcNuevo = crear(f, nuevo)
  const limpiarNuevo = (ctx) => (raizN) => {
    const v = (n) => {
      if (ts.isImportDeclaration(n) && n.getText() === IMPORT && n.getStart() === posImport + 1)
        return undefined
      if (esInsertado(n) && posInsertados.has(n.getStart())) return undefined
      if (esB(n) && posB.has(n.getStart())) return marca()
      if (ts.isObjectBindingPattern(n)) {
        const els = n.elements.filter((e) => !posAnadidas.has(e.getStart()))
        if (els.length !== n.elements.length)
          return ts.factory.updateObjectBindingPattern(
            n,
            els.map((e) => ts.visitEachChild(e, v, ctx))
          )
      }
      return ts.visitEachChild(n, v, ctx)
    }
    return ts.visitNode(raizN, v)
  }
  const limpiarOriginal = (ctx) => (raizN) => {
    const v = (n) =>
      ts.isReturnStatement(n) && retornosB.includes(n.getStart())
        ? marca()
        : ts.visitEachChild(n, v, ctx)
    return ts.visitNode(raizN, v)
  }
  const a = imprimir(ts.transform(src, [limpiarOriginal]).transformed[0])
  const b = imprimir(ts.transform(srcNuevo, [limpiarNuevo]).transformed[0])
  if (a !== b) {
    if (process.env.DIFF_DIR) {
      const base = path.join(process.env.DIFF_DIR, f.replace(/[\/\[\]]/g, '_'))
      fs.writeFileSync(base + '.original.txt', a)
      fs.writeFileSync(base + '.nuevo.txt', b)
    }
    informe.fallosAutocomprobacion.push(f)
    return
  }
  informe.ficheros.push({ f, ediciones: ediciones.length })
  if (ESCRIBIR) fs.writeFileSync(path.join(raiz, f), nuevo)
  if (SALIDA) {
    const d = path.join(SALIDA, f)
    fs.mkdirSync(path.dirname(d), { recursive: true })
    fs.writeFileSync(d, nuevo)
  }
}

for (const [f, lista] of porFichero) procesar(f, lista)
fs.writeFileSync(informePath, JSON.stringify(informe, null, 1))
console.log(
  `aplicados ${informe.aplicados.length} · apartados ${informe.apartados.length} · ficheros ${informe.ficheros.length} · fallos de autocomprobación ${informe.fallosAutocomprobacion.length}${ESCRIBIR ? ' · ESCRITO' : ' · (en seco)'}`
)
if (informe.fallosAutocomprobacion.length) {
  console.error('AUTOCOMPROBACIÓN: árbol distinto en', informe.fallosAutocomprobacion)
  process.exit(2)
}
