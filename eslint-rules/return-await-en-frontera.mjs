// Regla `nido/return-await-en-frontera` (censo C, B1, 2026-11-26). Una acción que recoge las lecturas
// fallidas con `try { … } catch (e) { return falloDeLectura(e) }` (o `contadorNoLeido`) solo las recoge si
// la promesa se rechaza DENTRO del `try`. `return f(…)` sin `await` devuelve la promesa tal cual: si `f`
// lanza una `LecturaFallida`, se rechaza fuera del `try`, el `catch` no la ve y llega al cliente como un
// throw (el spinner colgado que la frontera venía a evitar). Medido en firmar-autorizacion.ts: firmar con
// el vínculo sin leer salía por ahí, y el test unitario lo cazó. Exige `return await f(…)`.
//
// Qué NO cubre: la promesa guardada antes en una variable (`const p = f(); return p`), dentro de una
// condicional (`return x ? f() : g()`) o de una cadena `.then`. Tampoco sabe si `f` es asíncrona: con una
// función síncrona, `await` sobra pero no hace daño; las de la frontera que se sabe que lo son (`ok`,
// `fail`) quedan fuera.
const FRONTERA = new Set(['falloDeLectura', 'contadorNoLeido'])
const SINCRONAS = new Set(['ok', 'fail', 'falloDeLectura', 'contadorNoLeido'])
const FUNCION = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])

function llamaFrontera(nodo) {
  let hay = false
  const visitar = (n) => {
    if (!n || typeof n.type !== 'string' || hay) return
    if (
      n.type === 'CallExpression' &&
      n.callee.type === 'Identifier' &&
      FRONTERA.has(n.callee.name)
    ) {
      hay = true
      return
    }
    for (const k of Object.keys(n)) {
      if (k === 'parent') continue
      const v = n[k]
      if (Array.isArray(v)) v.forEach(visitar)
      else if (v && typeof v.type === 'string') visitar(v)
    }
  }
  visitar(nodo)
  return hay
}

function desenvolver(n) {
  let cur = n
  while (cur && (cur.type === 'TSAsExpression' || cur.type === 'TSNonNullExpression'))
    cur = cur.expression
  return cur
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Dentro de un try con la frontera de lectura, return await' },
    messages: {
      sinAwait:
        '`return {{f}}(…)` sin `await` dentro de un try cuya frontera es {{frontera}}: si la promesa se rechaza (una LecturaFallida), lo hace fuera del try y el catch no la recoge. Escribe `return await {{f}}(…)`.',
    },
    schema: [],
  },
  create(context) {
    return {
      TryStatement(t) {
        if (!t.handler || !llamaFrontera(t.handler.body)) return
        const visitar = (n) => {
          if (!n || typeof n.type !== 'string') return
          if (FUNCION.has(n.type)) return
          if (n.type === 'ReturnStatement') {
            const a = desenvolver(n.argument)
            if (a && a.type === 'CallExpression') {
              const f =
                a.callee.type === 'Identifier'
                  ? a.callee.name
                  : a.callee.type === 'MemberExpression' && !a.callee.computed
                    ? a.callee.property.name
                    : '…'
              if (!SINCRONAS.has(f))
                context.report({
                  node: n,
                  messageId: 'sinAwait',
                  data: { f, frontera: 'falloDeLectura/contadorNoLeido' },
                })
            }
          }
          for (const k of Object.keys(n)) {
            if (k === 'parent') continue
            const v = n[k]
            if (Array.isArray(v)) v.forEach(visitar)
            else if (v && typeof v.type === 'string') visitar(v)
          }
        }
        visitar(t.block)
      },
    }
  },
}
