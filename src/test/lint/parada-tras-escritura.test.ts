// @vitest-environment node
import tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import regla from '../../../eslint-rules/parada-tras-escritura.mjs'

/**
 * La regla `nido/parada-tras-escritura` (censo C, decisión de Jose del 2026-11-25): «una parada por
 * lectura fallida después de una escritura en la misma acción tiene que poner la CI roja». Su control:
 * cada forma de parar después de escribir da error; leer antes, no parar, o parar en otra función, no.
 */
RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const tester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
})

tester.run('parada-tras-escritura', regla, {
  valid: [
    // La lectura va ANTES de escribir.
    `async function f(s) { const { error } = await s.from('a').select(); if (error) throw new LecturaFallida('f', error); await s.from('a').insert({}) }`,
    // Después de escribir, no para: degrada y lo deja en Sentry.
    `async function f(s) { await s.from('a').insert({}); const { error } = await s.from('b').select(); if (error) lecturaFallidaTrasEscritura('f', error) }`,
    // La parada está en otra función (la ve el escáner de cadena, no esta regla).
    `async function f(s) { await s.from('a').insert({}); const g = async () => { const { error } = await s.from('b').select(); if (error) throw new LecturaFallida('g', error) } }`,
    // Una RPC estable de las migraciones (es_admin) no es escritura.
    `async function f(s) { await s.rpc('es_admin', { p_centro_id: 'x' }); const { error } = await s.from('b').select(); if (error) return fail('common.lectura_fallida') }`,
    // Un select no es escritura.
    `async function f(s) { await s.from('a').select(); const { error } = await s.from('b').select(); if (error) throw new LecturaFallida('f', error) }`,
  ],
  invalid: [
    {
      code: `async function f(s) { await s.from('a').insert({}); const { error } = await s.from('b').select(); if (error) throw new LecturaFallida('f', error) }`,
      errors: [{ messageId: 'tras' }],
    },
    {
      code: `async function f(s) { await s.rpc('validar_alta', {}); const { error } = await s.from('m').select(); if (error) return fail('common.lectura_fallida') }`,
      errors: [{ messageId: 'tras' }],
    },
    {
      code: `async function f(s) { await s.storage.from('b').upload('x', y); const { error } = await s.from('u').select(); if (error) throw new LecturaFallida('f', error) }`,
      errors: [{ messageId: 'tras' }],
    },
    {
      // Una RPC que no está en las migraciones cuenta como escritura.
      code: `async function f(s) { await s.rpc('no_existe_en_migraciones'); const { error } = await s.from('m').select(); if (error) throw new LecturaFallida('f', error) }`,
      errors: [{ messageId: 'tras' }],
    },
  ],
})
