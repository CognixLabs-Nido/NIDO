import { describe, expect, it } from 'vitest'

import { contarNoVistas, familiasConDomiciliacionNueva } from '../derivar'

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

/**
 * Aviso a Dirección: una familia firma o cambia su domiciliación por su cuenta. Cuenta el
 * mandato firmado con la familia YA dada de alta (algún hijo activado antes de la firma) y
 * cuya ficha no se ha abierto después de la firma.
 */
describe('familiasConDomiciliacionNueva', () => {
  const FIRMA = '2026-10-23T21:07:18Z'
  const ANTES = '2026-09-01T08:00:00Z'
  const DESPUES = '2026-10-24T08:00:00Z'
  const m = (familia_id: string, created_at = FIRMA) => ({ familia_id, created_at })

  it('familia ya dada de alta que firma y ficha sin abrir: avisa', () => {
    expect(familiasConDomiciliacionNueva([m('f1')], { f1: [ANTES] }, {})).toEqual(['f1'])
  })

  it('firma EN EL ALTA (ningún hijo activado): no avisa, Dirección la ve al validar', () => {
    expect(familiasConDomiciliacionNueva([m('f1')], {}, {})).toEqual([])
    expect(familiasConDomiciliacionNueva([m('f1')], { f1: [] }, {})).toEqual([])
  })

  it('la matrícula se activó DESPUÉS de la firma (validar el alta): no avisa', () => {
    expect(familiasConDomiciliacionNueva([m('f1')], { f1: [DESPUES] }, {})).toEqual([])
  })

  it('basta un hijo activado antes (el alta de un segundo hijo cuenta como ya dada de alta)', () => {
    expect(familiasConDomiciliacionNueva([m('f1')], { f1: [DESPUES, ANTES] }, {})).toEqual(['f1'])
  })

  it('ficha abierta después de la firma: el aviso desaparece', () => {
    expect(familiasConDomiciliacionNueva([m('f1')], { f1: [ANTES] }, { f1: DESPUES })).toEqual([])
  })

  it('un cambio posterior a la última apertura vuelve a avisar (por instante, no presencia)', () => {
    expect(familiasConDomiciliacionNueva([m('f1')], { f1: [ANTES] }, { f1: ANTES })).toEqual(['f1'])
  })

  it('cuenta familias, no mandatos (el cambio deja el revocado y el nuevo)', () => {
    const filas = [m('f1', '2026-10-01T10:00:00Z'), m('f1'), m('f2')]
    const activadas = { f1: [ANTES], f2: [ANTES] }
    expect(familiasConDomiciliacionNueva(filas, activadas, {})).toEqual(['f1', 'f2'])
  })

  it('la apertura de otra familia no apaga esta', () => {
    expect(familiasConDomiciliacionNueva([m('f1')], { f1: [ANTES] }, { f2: DESPUES })).toEqual([
      'f1',
    ])
  })
})
