import { describe, expect, it } from 'vitest'

import { centrosDelSuperusuario, centrosDelUsuario, resolverCentroActivo } from '../resolver'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const AJENO = '99999999-9999-4999-8999-999999999999'

/** Profe y admin en A, tutora en B: el caso de dos centros que hoy no existe en producción. */
const DOS_CENTROS = centrosDelUsuario([
  { centro_id: B, rol: 'tutor_legal' },
  { centro_id: A, rol: 'profe' },
  { centro_id: A, rol: 'admin' },
])

describe('centrosDelUsuario', () => {
  it('agrupa por centro, con el rol de más privilegios y todos los roles ordenados', () => {
    expect(DOS_CENTROS).toEqual([
      { centroId: A, rol: 'admin', roles: ['admin', 'profe'] },
      { centroId: B, rol: 'tutor_legal', roles: ['tutor_legal'] },
    ])
  })

  it('el orden no depende del orden de las filas', () => {
    const alReves = centrosDelUsuario([
      { centro_id: A, rol: 'admin' },
      { centro_id: A, rol: 'profe' },
      { centro_id: B, rol: 'tutor_legal' },
    ])
    expect(alReves).toEqual(DOS_CENTROS)
  })

  it('ignora roles que no son de la app (p. ej. service)', () => {
    expect(centrosDelUsuario([{ centro_id: A, rol: 'service' }])).toEqual([])
  })
})

describe('resolverCentroActivo', () => {
  it('sin roles: sin_centro', () => {
    expect(resolverCentroActivo([], A)).toEqual({ tipo: 'sin_centro' })
  })

  it('UN centro: ese, con o sin cookie, y aunque la cookie sea de otro (nunca selector)', () => {
    const uno = centrosDelUsuario([{ centro_id: A, rol: 'profe' }])
    for (const cookie of [undefined, A, B, AJENO, 'basura']) {
      const r = resolverCentroActivo(uno, cookie)
      expect(r.tipo, String(cookie)).toBe('activo')
      if (r.tipo === 'activo') expect(r.centro.centroId).toBe(A)
    }
  })

  it('DOS centros con cookie de uno de ellos: ese, con su rol', () => {
    const enA = resolverCentroActivo(DOS_CENTROS, A)
    const enB = resolverCentroActivo(DOS_CENTROS, B)
    expect(enA).toMatchObject({ tipo: 'activo', centro: { centroId: A, rol: 'admin' } })
    expect(enB).toMatchObject({ tipo: 'activo', centro: { centroId: B, rol: 'tutor_legal' } })
  })

  it.each([
    ['sin cookie', undefined],
    ['cookie vacía', ''],
    ['cookie de un centro que no es suyo', AJENO],
    ['cookie basura', 'no-es-un-uuid'],
  ])('DOS centros, %s: elegir (nunca uno por defecto)', (_caso, cookie) => {
    const r = resolverCentroActivo(DOS_CENTROS, cookie)
    expect(r).toEqual({ tipo: 'elegir', centros: DOS_CENTROS })
  })
})

describe('superusuario (Fase 3)', () => {
  const C = '33333333-3333-4333-8333-333333333333'

  it('centrosDelSuperusuario: admin en todos los centros, con sus roles propios sumados', () => {
    expect(centrosDelSuperusuario(DOS_CENTROS, [C, B, A])).toEqual([
      { centroId: A, rol: 'admin', roles: ['admin', 'profe'] },
      { centroId: B, rol: 'admin', roles: ['admin', 'tutor_legal'] },
      { centroId: C, rol: 'admin', roles: ['admin'] },
    ])
  })

  it('exigirEleccion: con UN centro y sin cookie, elige (no entra solo)', () => {
    const uno = centrosDelSuperusuario([], [A])
    expect(resolverCentroActivo(uno, undefined, { exigirEleccion: true })).toEqual({
      tipo: 'elegir',
      centros: uno,
    })
    // Sin la opción, el usuario normal con un centro entra directo, como siempre.
    expect(resolverCentroActivo(uno, undefined)).toMatchObject({ tipo: 'activo' })
  })

  it('exigirEleccion: con la cookie de un centro que existe, ese; con una ajena, elegir', () => {
    const uno = centrosDelSuperusuario([], [A])
    expect(resolverCentroActivo(uno, A, { exigirEleccion: true })).toMatchObject({
      tipo: 'activo',
      centro: { centroId: A, rol: 'admin' },
    })
    expect(resolverCentroActivo(uno, AJENO, { exigirEleccion: true })).toMatchObject({
      tipo: 'elegir',
    })
  })
})
