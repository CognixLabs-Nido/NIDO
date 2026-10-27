// @vitest-environment node
import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import * as tipos from '../types'

/**
 * Los plazos de conservación son una decisión del responsable (provisional, PENDIENTE política
 * F11-B), y la decisión vive en la tabla de `docs/specs/retencion-plazos.md`. Cada constante de
 * plazo tiene que estar en la tabla con su mismo valor, y cada fila de la tabla tiene que ser una
 * constante: así el código no puede cambiar un plazo sin cambiar la decisión escrita, ni al revés.
 */

const spec = readFileSync(join(process.cwd(), 'docs/specs/retencion-plazos.md'), 'utf8')

/** Las filas de la tabla de plazos: `| \`CONSTANTE\` | valor | …`. */
const tabla = new Map(
  [...spec.matchAll(/^\|\s*`((?:RETENCION|GRACIA)_[A-Z_]+)`\s*\|\s*(\d+)\s*\|/gm)].map((m) => [
    m[1]!,
    Number(m[2]),
  ])
)

/** Las constantes de plazo que exporta el módulo, leídas de él (no enumeradas aquí). */
const constantes = new Map(
  Object.entries(tipos).filter(
    (e): e is [string, number] => /^(RETENCION|GRACIA)_/.test(e[0]) && typeof e[1] === 'number'
  )
)

describe('plazos de conservación', () => {
  it('la spec y el código tienen plazos que comparar', () => {
    // Premisa: si el patrón dejara de casar con la tabla, los asertos de abajo pasarían vacíos.
    expect(tabla.size).toBeGreaterThanOrEqual(13)
    expect(constantes.size).toBeGreaterThanOrEqual(13)
  })

  it('cada constante está en la tabla, con el mismo valor', () => {
    for (const [nombre, valor] of constantes) expect(tabla.get(nombre), nombre).toBe(valor)
  })

  it('cada fila de la tabla es una constante del código', () => {
    for (const nombre of tabla.keys()) expect(constantes.has(nombre), nombre).toBe(true)
  })
})
