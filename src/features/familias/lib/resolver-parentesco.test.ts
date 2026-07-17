import { describe, expect, it } from 'vitest'

import { resolverParentesco } from './resolver-parentesco'

describe('resolverParentesco (D-4 punto 3, híbrido)', () => {
  it('HEREDA del vínculo previo del titular cuando existe (ignora el form)', () => {
    const r = resolverParentesco(
      { parentesco: 'madre', descripcion_parentesco: null },
      'padre',
      'no debería usarse'
    )
    expect(r).toEqual({ ok: true, parentesco: 'madre', descripcionParentesco: '' })
  })

  it('hereda también la descripción del vínculo previo (parentesco otro)', () => {
    const r = resolverParentesco(
      { parentesco: 'otro', descripcion_parentesco: 'madrina' },
      undefined,
      undefined
    )
    expect(r).toEqual({ ok: true, parentesco: 'otro', descripcionParentesco: 'madrina' })
  })

  it('usa el parentesco del form cuando NO hay herencia', () => {
    const r = resolverParentesco(null, 'abuela', undefined)
    expect(r).toEqual({ ok: true, parentesco: 'abuela', descripcionParentesco: '' })
  })

  it('usa parentesco + descripción del form (otro) cuando no hay herencia', () => {
    const r = resolverParentesco(null, 'otro', 'tío abuelo')
    expect(r).toEqual({ ok: true, parentesco: 'otro', descripcionParentesco: 'tío abuelo' })
  })

  it('FALLA cuando no hay herencia NI parentesco del form (nunca cae a "otro")', () => {
    const r = resolverParentesco(null, undefined, undefined)
    expect(r).toEqual({ ok: false })
  })
})
