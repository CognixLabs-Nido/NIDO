#!/usr/bin/env node
// ¿El `src/types/database.ts` commiteado es lo que sale del generador sobre las migraciones?
//
// `database.ts` se genera desde PRODUCCIÓN (`npm run db:types`) y no se toca a mano: lo que el
// generador no sabe va en `src/types/db.ts`, encima. La CI regenera los tipos contra la base
// efímera (las migraciones del repo) y este script los compara con el commiteado. Si difieren,
// o falta una migración en el repo, o alguien tocó el fichero a mano: rojo.
//
// Las dos salidas no son idénticas byte a byte aunque el esquema lo sea (medido en la CI, run
// 43214683802), por dos cosas que NO son esquema y que se normalizan aquí, y solo esas dos:
//   1. el bloque `__InternalSupabase { PostgrestVersion }`: lo emite `--project-id` y no `--db-url`;
//   2. el formato de los tipos auxiliares (paréntesis en `TableName extends (…) = never`): cada
//      postgres-meta lo escribe a su manera. Se pasan los dos por Prettier con opciones fijas.
// Las copias normalizadas son temporales; el fichero commiteado no se reformatea nunca.
//
// Uso: node scripts/ci/comparar-tipos.mjs <commiteado> <generado>   (sale con 1 si difieren)

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as prettier from 'prettier'

const BLOQUE_INTERNO =
  /  \/\/ Allows to automatically instantiate createClient with right options\n  \/\/ instead of createClient<Database, \{ PostgrestVersion: 'XX' \}>\(URL, KEY\)\n  __InternalSupabase: \{\n    PostgrestVersion: "[0-9.]+"\n  \}\n/g

const [commiteado, generado] = process.argv.slice(2)
if (!commiteado || !generado) {
  console.error('uso: comparar-tipos.mjs <commiteado> <generado>')
  process.exit(2)
}

async function normaliza(fichero) {
  const fuente = readFileSync(fichero, 'utf8')
  const lineas = fuente.split('\n').length
  const quitados = fuente.match(BLOQUE_INTERNO)?.length ?? 0
  process.stdout.write(
    `${fichero}: ${lineas} líneas · bloque __InternalSupabase quitado ${quitados} de 1 posible\n`
  )
  if (lineas < 100) throw new Error(`${fichero}: ${lineas} líneas, el generador no ha sacado tipos`)
  if (quitados > 1)
    throw new Error(`${fichero}: el bloque __InternalSupabase sale ${quitados} veces`)
  // Opciones fijas, sin el .prettierrc del repo: la normalización no depende de él.
  return prettier.format(fuente.replace(BLOQUE_INTERNO, ''), {
    parser: 'typescript',
    semi: true,
    singleQuote: false,
    printWidth: 100,
  })
}

let a, b
try {
  a = await normaliza(commiteado)
  b = await normaliza(generado)
} catch (e) {
  console.error(`FALLO: ${e.message}`)
  process.exit(1)
}
if (a === b) {
  process.stdout.write(`IGUALES tras normalizar (${a.split('\n').length} líneas)\n`)
  process.exit(0)
}
const dir = mkdtempSync(path.join(tmpdir(), 'tipos-'))
const fa = path.join(dir, 'commiteado.ts')
const fb = path.join(dir, 'generado.ts')
writeFileSync(fa, a)
writeFileSync(fb, b)
try {
  execFileSync('diff', ['-u', fa, fb], { stdio: 'inherit' })
} catch {
  // diff sale con 1 al encontrar diferencias: es lo esperado aquí.
}
console.error(
  'DISTINTOS: src/types/database.ts no es lo que generan las migraciones. Regenera con ' +
    '`npm run db:types` tras aplicar, y no lo toques a mano (lo que el generador no sabe va en src/types/db.ts).'
)
process.exit(1)
