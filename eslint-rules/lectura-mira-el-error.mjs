// Regla `nido/lectura-mira-el-error` (censo C, decisión de Jose del 2026-11-25): una llamada a Supabase
// (`.from(…)`, `.rpc(…)`, `.storage.from(…)`) cuyo `error` no se mira hace que un fallo se lea como «no
// hay» (o, al escribir, como «hecho»). Marca:
//   1. el resultado destructurado SIN `error`:            const { data } = await supabase.from('x')…
//   2. `error` destructurado que solo se loguea o nada:   const { data, error } = …; logger.warn(error.message)
//   3. el resultado en una variable cuyo `.error` no se lee (y que no se pasa entero a otra función);
//   4. la llamada esperada y tirada:                      await supabase.from('x').insert(…)
// Lo mismo dentro de un `Promise.all([...])` destructurado.
//
// Lo que NO ve: un `if (error) return []` (lo mira y lo convierte en vacío). Eso no se distingue de un
// tratamiento bueno por la forma; lo vigila el censo, no el lint.
//
// LISTA BLANCA TEMPORAL (`lectura-mira-el-error.lista-blanca.json`): fichero → cuántos sitios tiene hoy.
// Un fichero con MÁS sitios que los de su lista se pone rojo entero: un sitio nuevo con el patrón viejo
// no se cuela por estar en un fichero que ya tenía alguno. La lista solo puede bajar, y BAJA (2026-11-26): un
// fichero con MENOS sitios que los de su lista también se pone rojo, con el número al que hay que bajarla. Sin
// esto, el arreglo de un sitio dejaba hueco para que otro con el patrón viejo entrara sin que nadie lo viera.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const LISTA = JSON.parse(
  fs.readFileSync(path.join(dir, 'lectura-mira-el-error.lista-blanca.json'), 'utf8')
)
const NO_SUPABASE = /^(Array|Object|Buffer|Uint8Array|Int8Array|Float32Array|Set|Map|String|Date)$/

/** ¿Esta expresión es (o termina en) una cadena de Supabase? */
function esCadenaSupabase(n) {
  let cur = n
  while (cur) {
    if (
      cur.type === 'CallExpression' &&
      cur.callee.type === 'MemberExpression' &&
      !cur.callee.computed
    ) {
      const m = cur.callee.property.name
      const obj = cur.callee.object
      if (m === 'rpc') return true
      if (m === 'from') {
        const nombre =
          obj.type === 'Identifier'
            ? obj.name
            : obj.type === 'MemberExpression' && !obj.computed
              ? obj.property.name
              : ''
        if (!NO_SUPABASE.test(nombre) && cur.arguments.length === 1) return true
      }
      cur = obj
      continue
    }
    if (cur.type === 'MemberExpression') {
      cur = cur.object
      continue
    }
    return false
  }
  return false
}

function desenvolver(n) {
  let cur = n
  let awaited = false
  for (;;) {
    if (!cur) return { expr: null, awaited }
    if (cur.type === 'AwaitExpression') {
      awaited = true
      cur = cur.argument
      continue
    }
    if (
      cur.type === 'TSAsExpression' ||
      cur.type === 'TSNonNullExpression' ||
      cur.type === 'ChainExpression'
    ) {
      cur = cur.expression
      continue
    }
    return { expr: cur, awaited }
  }
}

function funcionDe(nodo) {
  let c = nodo.parent
  while (c && !/Function/.test(c.type)) c = c.parent
  return c
}

/** Las referencias a `nombre` dentro de `raiz`, después de `desde`. */
function referencias(raiz, nombre, desde, sourceCode) {
  const out = []
  const visitar = (n, padre) => {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'Identifier' && n.name === nombre && n.range[0] > desde) {
      const esClave =
        padre && padre.type === 'Property' && padre.key === n && !padre.computed && !padre.shorthand
      const esMiembro =
        padre && padre.type === 'MemberExpression' && padre.property === n && !padre.computed
      if (!esClave && !esMiembro) out.push({ n, padre })
    }
    for (const k of sourceCode.visitorKeys[n.type] ?? []) {
      const v = n[k]
      if (Array.isArray(v)) v.forEach((x) => visitar(x, n))
      else visitar(v, n)
    }
  }
  visitar(raiz, null)
  return out
}

/** ¿Un bloque solo loguea (ni lanza, ni devuelve, ni asigna)? */
function soloLoguea(st) {
  if (!st) return true
  const sts = st.type === 'BlockStatement' ? st.body : [st]
  return sts.every(
    (x) =>
      x.type === 'ExpressionStatement' &&
      x.expression.type === 'CallExpression' &&
      x.expression.callee.type === 'MemberExpression' &&
      x.expression.callee.object.type === 'Identifier' &&
      /^(logger|console)$/.test(x.expression.callee.object.name)
  )
}

/**
 * ¿La referencia está solo como argumento de logger.* / console.*, o en la condición de un `if` cuya rama
 * solo loguea (`if (error) logger.warn(…)` y sigue como si nada)?
 */
function soloLog(ref) {
  let c = ref.n
  while (c && c.parent) {
    const p = c.parent
    if (p.type === 'IfStatement' && p.test === c) return soloLoguea(p.consequent) && !p.alternate
    if (
      p.type === 'CallExpression' &&
      p.callee.type === 'MemberExpression' &&
      p.callee.object.type === 'Identifier' &&
      /^(logger|console)$/.test(p.callee.object.name) &&
      p.arguments.includes(c)
    )
      return true
    if (/Statement|Declaration/.test(p.type)) return false
    c = p
  }
  return false
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Una llamada a Supabase tiene que mirar su `error` (censo C).' },
    schema: [],
    messages: {
      sinError:
        'Lectura/escritura de Supabase sin mirar `error`: un fallo se leería como «no hay» o como «hecho». Mira el error (LecturaFallida o fail).',
      soloLog:
        '`error` solo se loguea (o ni eso): el fallo sigue leyéndose como «no hay». Lanza LecturaFallida o devuelve fail.',
      tirada: 'Llamada a Supabase esperada y tirada: si falla, nadie se entera.',
      lista:
        'Este fichero tiene {{hay}} sitios sin mirar el error y su lista blanca temporal admite {{admite}}: hay uno nuevo con el patrón viejo.',
      baja: 'La lista blanca temporal admite {{admite}} sitios en este fichero y ya solo tiene {{hay}}: bájala a {{hay}} en lectura-mira-el-error.lista-blanca.json (o quítalo si es 0).',
    },
  },
  create(context) {
    const sc = context.sourceCode
    const rel = path.relative(process.cwd(), context.filename).split(path.sep).join('/')
    const hallados = []

    function revisarPatron(idNodo, declNodo) {
      const fn = funcionDe(declNodo) ?? sc.ast
      if (idNodo.type === 'ObjectPattern') {
        const prop = idNodo.properties.find(
          (p) =>
            p.type === 'Property' &&
            !p.computed &&
            p.key.type === 'Identifier' &&
            p.key.name === 'error'
        )
        if (!prop) {
          hallados.push({ node: idNodo, messageId: 'sinError' })
          return
        }
        const local =
          prop.value.type === 'Identifier'
            ? prop.value.name
            : prop.value.type === 'AssignmentPattern' && prop.value.left.type === 'Identifier'
              ? prop.value.left.name
              : null
        if (!local) return
        const refs = referencias(fn, local, declNodo.range[1], sc)
        if (refs.length === 0 || refs.every(soloLog))
          hallados.push({ node: prop, messageId: 'soloLog' })
      } else if (idNodo.type === 'Identifier') {
        const refs = referencias(fn, idNodo.name, declNodo.range[1], sc)
        const leeError = refs.some(
          (r) =>
            r.padre &&
            r.padre.type === 'MemberExpression' &&
            r.padre.object === r.n &&
            !r.padre.computed &&
            r.padre.property.name === 'error' &&
            !soloLog({ n: r.padre })
        )
        // Se devuelve, se pasa entero a una función o se mete en una lista (`for (const r of [a, b]) if
        // (r.error) …`, el patrón de leer-panel-becas; cruce con el censo del 2026-11-25): quien lo
        // recibe es quien mira el error.
        const seDevuelveOSePasa = refs.some(
          (r) =>
            r.padre &&
            (r.padre.type === 'ReturnStatement' ||
              (r.padre.type === 'CallExpression' && r.padre.arguments.includes(r.n)) ||
              r.padre.type === 'ArrowFunctionExpression' ||
              r.padre.type === 'ArrayExpression')
        )
        if (!leeError && !seDevuelveOSePasa) hallados.push({ node: idNodo, messageId: 'sinError' })
      }
    }

    return {
      VariableDeclarator(node) {
        const { expr, awaited } = desenvolver(node.init)
        if (!expr || !awaited) return
        if (esCadenaSupabase(expr)) {
          revisarPatron(node.id, node)
          return
        }
        // Promise.all([...]) destructurado
        if (
          expr.type === 'CallExpression' &&
          expr.callee.type === 'MemberExpression' &&
          expr.callee.object.type === 'Identifier' &&
          expr.callee.object.name === 'Promise' &&
          /^all(Settled)?$/.test(expr.callee.property.name) &&
          node.id.type === 'ArrayPattern' &&
          expr.arguments[0] &&
          expr.arguments[0].type === 'ArrayExpression'
        ) {
          expr.arguments[0].elements.forEach((el, i) => {
            const pat = node.id.elements[i]
            if (el && pat && esCadenaSupabase(desenvolver(el).expr)) revisarPatron(pat, node)
          })
        }
      },
      ExpressionStatement(node) {
        const { expr, awaited } = desenvolver(node.expression)
        if (awaited && expr && esCadenaSupabase(expr)) hallados.push({ node, messageId: 'tirada' })
      },
      'Program:exit'() {
        const admite = LISTA[rel] ?? 0
        if (hallados.length < admite) {
          context.report({
            loc: { line: 1, column: 0 },
            messageId: 'baja',
            data: { hay: String(hallados.length), admite: String(admite) },
          })
          return
        }
        if (hallados.length === 0) return
        if (hallados.length <= admite) return
        if (admite > 0) {
          for (const h of hallados)
            context.report({
              node: h.node,
              messageId: 'lista',
              data: { hay: String(hallados.length), admite: String(admite) },
            })
          return
        }
        for (const h of hallados) context.report(h)
      },
    }
  },
}
