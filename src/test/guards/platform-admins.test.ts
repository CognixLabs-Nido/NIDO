// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { sinComentarios } from '../../../scripts/check-centro-activo.mjs'

/**
 * Quién es superusuario lo dice `platform_admins`, y esa tabla se escribe SOLO en migraciones
 * (ADR-0061): no tiene policies ni permisos para la app. El código de la app ni la lee ni la
 * escribe, tampoco con service role (que se salta la RLS): pregunta con la RPC `is_superadmin`.
 * Este censo se pone rojo si un fichero de `src/` nombra la tabla fuera de un comentario.
 */

const RAIZ = path.resolve(__dirname, '../../..')
const RE_TABLA = /\bplatform_admins\b/
// El tipo generado de la base de datos la describe: no es código que la toque.
const DESCRIBEN_LA_TABLA = new Set(['src/types/database.ts'])

function ficheros(dir: string): string[] {
  const res: string[] = []
  for (const nombre of readdirSync(dir)) {
    const abs = path.join(dir, nombre)
    if (statSync(abs).isDirectory()) {
      if (nombre === '__tests__' || nombre === 'test') continue
      res.push(...ficheros(abs))
    } else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\.(ts|tsx)$/.test(nombre)) {
      res.push(path.relative(RAIZ, abs).split(path.sep).join('/'))
    }
  }
  return res
}

describe('platform_admins: la app no la toca', () => {
  it('ningún fichero de src/ la nombra fuera de un comentario (salvo el tipo generado)', () => {
    const todos = ficheros(path.join(RAIZ, 'src'))
    // Premisa: el recorrido llega al tipo generado, que sí la nombra (el patrón caza).
    expect(todos).toContain('src/types/database.ts')
    expect(readFileSync(path.join(RAIZ, 'src/types/database.ts'), 'utf8')).toMatch(RE_TABLA)
    const laNombran = todos.filter(
      (rel) =>
        !DESCRIBEN_LA_TABLA.has(rel) &&
        RE_TABLA.test(sinComentarios(readFileSync(path.join(RAIZ, rel), 'utf8')))
    )
    expect(laNombran).toEqual([])
  })

  it('el patrón caza una lectura y no un comentario', () => {
    expect(
      sinComentarios("await svc.from('platform_admins').select()").match(RE_TABLA)
    ).toHaveLength(1)
    expect(
      sinComentarios('// platform_admins se escribe en migraciones\nexport {}').match(RE_TABLA)
    ).toBeNull()
  })
})
