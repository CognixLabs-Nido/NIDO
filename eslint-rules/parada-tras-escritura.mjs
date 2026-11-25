// Regla `nido/parada-tras-escritura` (censo C, decisión de Jose del 2026-11-25): «una parada por lectura
// fallida después de una escritura en la misma acción tiene que poner la CI roja». Si una función ya
// escribió (insert/update/upsert/delete de `.from(…)`, upload/remove/move/copy de `.storage.from(…)`, o
// `.rpc('f')` de una función VOLATILE según las migraciones) y después para por una lectura fallida
// (`throw new LecturaFallida(…)` o `return fail('common.lectura_fallida')`), la pantalla dirá «no se
// guardó» sobre algo guardado, y quien reintente duplicará. Lo de después no para: `siFallaTrasEscribir`
// o `lecturaFallidaTrasEscritura` (src/shared/lib/tras-escritura.ts), o se dice lo que no salió.
//
// Qué NO cubre (lo cubre el escáner de cadena de la CI, `scripts/ci/cadena-tras-escritura.cjs`): la
// escritura o la parada dentro de OTRA función a la que se llama. Orden de texto, no de flujo: una
// escritura en una rama que devuelve antes cuenta igual (se reescribe, o se lleva la lectura antes).
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const dir = path.dirname(fileURLToPath(import.meta.url))
const { volatilidadDeMigraciones } = require('../scripts/ci/cadena-tras-escritura.cjs')
let VOL = null
const vol = () => (VOL ??= volatilidadDeMigraciones(path.join(dir, '..', 'supabase/migrations')))

const ESC_METODO = /^(insert|update|upsert|delete)$/
const ESC_STORAGE = /^(upload|remove|move|copy)$/

/** ¿Esta llamada escribe? Devuelve una etiqueta o null. */
function escritura(call, volatilidad) {
  if (call.callee.type !== 'MemberExpression' || call.callee.computed) return null
  const m = call.callee.property.name
  if (m === 'rpc') {
    const a = call.arguments[0]
    if (!a || a.type !== 'Literal' || typeof a.value !== 'string') return null
    const v = volatilidad.get(a.value.toLowerCase())
    return v === undefined || v === 'v' ? `rpc('${a.value}')` : null
  }
  let cur = call.callee.object
  let haciaFrom = false
  let storage = false
  while (cur) {
    if (
      cur.type === 'CallExpression' &&
      cur.callee.type === 'MemberExpression' &&
      !cur.callee.computed
    ) {
      if (cur.callee.property.name === 'from') haciaFrom = true
      cur = cur.callee.object
      continue
    }
    if (cur.type === 'MemberExpression') {
      if (!cur.computed && cur.property.name === 'storage') storage = true
      cur = cur.object
      continue
    }
    break
  }
  if (!haciaFrom) return null
  if (storage && ESC_STORAGE.test(m)) return `storage.${m}`
  if (!storage && ESC_METODO.test(m)) return `.${m}()`
  return null
}

function esParada(n) {
  if (
    n.type === 'ThrowStatement' &&
    n.argument?.type === 'NewExpression' &&
    n.argument.callee.type === 'Identifier' &&
    n.argument.callee.name === 'LecturaFallida'
  )
    return true
  if (
    n.type === 'ReturnStatement' &&
    n.argument?.type === 'CallExpression' &&
    n.argument.callee.type === 'Identifier' &&
    n.argument.callee.name === 'fail'
  ) {
    const a = n.argument.arguments[0]
    return !!a && a.type === 'Literal' && a.value === 'common.lectura_fallida'
  }
  return false
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Una lectura fallida después de una escritura hecha no para (censo C).' },
    schema: [],
    messages: {
      tras: 'Parada por lectura fallida DESPUÉS de una escritura ({{que}}, línea {{linea}}): la pantalla diría «no se guardó» sobre algo guardado. Usa siFallaTrasEscribir / lecturaFallidaTrasEscritura, o di lo que no salió.',
    },
  },
  create(context) {
    const sc = context.sourceCode
    const volatilidad = vol()
    function revisar(fn) {
      if (!fn.body || fn.body.type !== 'BlockStatement') return
      let primera = null
      const visitar = (n) => {
        if (!n || typeof n.type !== 'string') return
        // Las funciones anidadas tienen su propia pasada.
        if (n !== fn.body && /Function/.test(n.type)) return
        if (n.type === 'CallExpression' && !primera) {
          const e = escritura(n, volatilidad)
          if (e) primera = { que: e, linea: n.loc.start.line }
        }
        if (primera && esParada(n))
          context.report({
            node: n,
            messageId: 'tras',
            data: { que: primera.que, linea: String(primera.linea) },
          })
        for (const k of sc.visitorKeys[n.type] ?? []) {
          const v = n[k]
          if (Array.isArray(v)) v.forEach(visitar)
          else visitar(v)
        }
      }
      visitar(fn.body)
    }
    return {
      FunctionDeclaration: revisar,
      FunctionExpression: revisar,
      ArrowFunctionExpression: revisar,
    }
  },
}
