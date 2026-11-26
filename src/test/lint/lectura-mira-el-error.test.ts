// @vitest-environment node
import { RuleTester } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import { describe, it } from 'vitest'

import regla from '../../../eslint-rules/lectura-mira-el-error.mjs'

/**
 * La regla `nido/lectura-mira-el-error` (censo C, decisión de Jose del 2026-11-25): «un sitio nuevo con el
 * patrón viejo tiene que poner la CI roja». Estos casos son su control: cada forma del patrón viejo da
 * error, y las formas buenas no. La lista blanca va por fichero real; aquí los ficheros no están en ella.
 */
RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const tester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
})

tester.run('lectura-mira-el-error', regla, {
  valid: [
    // Mira el error y lanza.
    `async function f(s) { const { data, error } = await s.from('a').select('id'); if (error) throw new Error('x'); return data }`,
    // Mira el error y devuelve un fallo.
    `async function f(s) { const { error } = await s.from('a').insert({}); if (error) return fail('x') }`,
    // Resultado en variable, mira .error.
    `async function f(s) { const r = await s.rpc('c'); if (r.error) throw r.error; return r.data }`,
    // Lo pasa entero a quien lo trata.
    `async function f(s) { const r = await s.rpc('c'); return tratar(r) }`,
    // Promise.all con los dos errores mirados.
    `async function f(s) { const [{ data: a, error: e1 }, { data: b, error: e2 }] = await Promise.all([s.from('a').select(), s.from('b').select()]); if (e1 || e2) throw new Error('x'); return [a, b] }`,
    // Promise.all a variables y el error mirado en un bucle sobre la lista (leer-panel-becas, cruce del
    // lint con el censo del 2026-11-25: era un falso positivo).
    `async function f(s) { const [a, b] = await Promise.all([s.from('a').select(), s.from('b').select()]); for (const r of [a, b]) { if (r.error) throw new Error('x') } return [a.data, b.data] }`,
    // No es Supabase.
    `async function f() { const { data } = await Array.from([1]); return data }`,
    // Sin await: un builder, no un resultado.
    `function f(s) { let q = s.from('a').select('id'); return q }`,
  ],
  invalid: [
    {
      code: `async function f(s) { const { data } = await s.from('a').select('id'); return data ?? [] }`,
      errors: [{ messageId: 'sinError' }],
    },
    {
      code: `async function f(s) { const { data, error } = await s.from('a').select('id'); if (error) logger.warn('f', error.message); return data ?? [] }`,
      errors: [{ messageId: 'soloLog' }],
    },
    {
      code: `async function f(s) { const { data, error } = await s.from('a').select('id'); return data }`,
      errors: [{ messageId: 'soloLog' }],
    },
    {
      code: `async function f(s) { const r = await s.rpc('c'); return r.data ?? 0 }`,
      errors: [{ messageId: 'sinError' }],
    },
    {
      code: `async function f(s) { await s.from('a').insert({}) }`,
      errors: [{ messageId: 'tirada' }],
    },
    {
      code: `async function f(s) { await s.storage.from('b').remove(['x']) }`,
      errors: [{ messageId: 'tirada' }],
    },
    {
      code: `async function f(s) { const [{ data: a }, { data: b, error }] = await Promise.all([s.from('a').select(), s.from('b').select()]); if (error) throw error; return [a, b] }`,
      errors: [{ messageId: 'sinError' }],
    },
  ],
})
