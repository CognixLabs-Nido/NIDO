import { describe, expect, it } from 'vitest'

import { contarNoVistas } from '../derivar'

/**
 * Derivación del aviso de inicio (F9-3 informes, F10-2 fotos): "nuevas" = filas
 * visibles (ya filtradas por RLS) que el usuario aún no ha abierto.
 */
describe('contarNoVistas', () => {
  const filas = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('sin nada visto: todas son nuevas', () => {
    expect(contarNoVistas(filas, {})).toBe(3)
  })

  it('descuenta solo las vistas (por presencia de la clave)', () => {
    expect(contarNoVistas(filas, { a: '2026-06-12T10:00:00Z' })).toBe(2)
    expect(contarNoVistas(filas, { a: 'x', c: 'y' })).toBe(1)
  })

  it('todas vistas: 0 (el contador baja al verlas)', () => {
    expect(contarNoVistas(filas, { a: 'x', b: 'y', c: 'z' })).toBe(0)
  })

  it('sin filas visibles: 0 (familia sin permiso → RLS devuelve [])', () => {
    expect(contarNoVistas([], { a: 'x' })).toBe(0)
  })

  it('ignora ids vistos que ya no están visibles', () => {
    expect(contarNoVistas([{ id: 'a' }], { z: 'x' })).toBe(1)
  })
})
