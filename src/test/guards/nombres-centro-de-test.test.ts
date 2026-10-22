// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Desde 20261104120000 (Fase 5, PR 2) dos centros vivos no pueden llamarse igual, sin distinguir
 * mayúsculas ni espacios (`idx_centros_nombre_vivo_unico`). Los tests que crean un centro con un
 * nombre fijo (`createTestCentro('…')`) comparten la BD de su shard: si dos ficheros usan el mismo
 * nombre y coinciden en el tiempo, o un teardown deja vivo el primero, el `beforeAll` del segundo
 * da 23505 y se cae el fichero entero. Este censo se pone rojo si dos ficheros lo repiten.
 */

const RAIZ = path.resolve(__dirname, '../../..')
const RE_NOMBRE_FIJO = /createTestCentro\(\s*['"]([^'"]+)['"]/g

/** La misma normalización que el índice: sin espacios de los lados, colapsados y en minúsculas. */
const normalizar = (nombre: string) => nombre.trim().replace(/\s+/g, ' ').toLowerCase()

function ficheros(dir: string): string[] {
  const res: string[] = []
  for (const nombre of readdirSync(dir)) {
    const abs = path.join(dir, nombre)
    if (statSync(abs).isDirectory()) res.push(...ficheros(abs))
    else if (/\.(ts|tsx)$/.test(nombre))
      res.push(path.relative(RAIZ, abs).split(path.sep).join('/'))
  }
  return res
}

describe('nombres de centro de los tests: uno por fichero', () => {
  it('ningún nombre fijo de createTestCentro se repite entre dos ficheros', () => {
    const usos = new Map<string, Set<string>>()
    for (const f of ficheros(path.join(RAIZ, 'src'))) {
      for (const m of readFileSync(path.join(RAIZ, f), 'utf8').matchAll(RE_NOMBRE_FIJO)) {
        const clave = normalizar(m[1])
        usos.set(clave, (usos.get(clave) ?? new Set()).add(f))
      }
    }
    // Premisa: el patrón caza los nombres fijos de verdad (hay más de cien).
    expect(usos.size).toBeGreaterThan(100)
    expect(usos.get('centro citas b')).toEqual(new Set(['src/test/rls/citas.rls.test.ts']))

    const repetidos = [...usos].filter(([, fs]) => fs.size > 1).map(([n, fs]) => `${n}: ${[...fs]}`)
    expect(repetidos).toEqual([])
  })

  it('la normalización es la del índice', () => {
    expect(normalizar('  Centro   AGENDA b ')).toBe(normalizar('centro agenda B'))
  })
})
