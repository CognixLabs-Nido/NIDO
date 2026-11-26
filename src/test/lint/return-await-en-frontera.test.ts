// @vitest-environment node
import tsParser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import regla from '../../../eslint-rules/return-await-en-frontera.mjs'

/**
 * La regla `nido/return-await-en-frontera` (censo C, B1, 2026-11-26): dentro de un try cuya frontera es
 * `falloDeLectura`, un `return f(…)` sin `await` deja escapar la LecturaFallida de `f`. Su control: cada
 * forma de devolver la promesa sin esperarla da error; con `await`, con `ok`/`fail`, sin la frontera, o en
 * una función de dentro, no.
 */
RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const tester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
})

tester.run('return-await-en-frontera', regla, {
  valid: [
    `async function a() { try { return await nucleo() } catch (e) { return falloDeLectura(e) } }`,
    `async function a() { try { if (x) return fail('no'); return ok(1) } catch (e) { return falloDeLectura(e) } }`,
    // Sin la frontera, el catch no es de lecturas: no es cosa de esta regla.
    `async function a() { try { return nucleo() } catch (e) { return fail('x') } }`,
    // El return de una función de dentro devuelve de ESA función.
    `async function a() { try { const g = () => nucleo(); return ok(await g()) } catch (e) { return falloDeLectura(e) } }`,
    `async function a() { try { return await s.cosa() } catch (e) { return contadorNoLeido(e) } }`,
  ],
  invalid: [
    {
      code: `async function a() { try { return nucleo(1) } catch (e) { return falloDeLectura(e) } }`,
      errors: [{ messageId: 'sinAwait' }],
    },
    {
      code: `async function a() { try { if (x) { return otra.cosa() } return ok(1) } catch (e) { return falloDeLectura(e) } }`,
      errors: [{ messageId: 'sinAwait' }],
    },
    {
      code: `async function a() { try { return nucleo() as Promise<R> } catch (e) { return contadorNoLeido(e) } }`,
      errors: [{ messageId: 'sinAwait' }],
    },
  ],
})
