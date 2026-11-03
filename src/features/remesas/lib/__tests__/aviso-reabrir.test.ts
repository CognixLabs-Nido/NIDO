import { describe, expect, it } from 'vitest'

import { casoReabrir, puedeReabrirRemesa } from '../aviso-reabrir'

/** Las dos reglas del aviso que no dependen de la BD: quién ve el botón y qué caso se enseña. */
describe('puedeReabrirRemesa', () => {
  it.each([
    [{ esResponsable: true, esSuperusuario: false }, true],
    // El superusuario es responsable de todo centro en la app, y la BD no le deja (es_titular).
    [{ esResponsable: true, esSuperusuario: true }, false],
    [{ esResponsable: false, esSuperusuario: false }, false],
  ])('%o → %s', (ctx, puede) => {
    expect(puedeReabrirRemesa(ctx)).toBe(puede)
  })
})

describe('casoReabrir', () => {
  it.each([
    [{ estado: 'enviada', fichero_generado_at: '2026-10-19T09:00:00+00:00' }, 'enviada'],
    [{ estado: 'enviada', fichero_generado_at: null }, 'enviada_sin_constancia'],
    [
      { estado: 'borrador', fichero_generado_at: '2026-10-19T09:00:00+00:00' },
      'fichero_descargado',
    ],
  ] as const)('%o → %s', (r, caso) => {
    expect(casoReabrir(r)).toBe(caso)
  })
})
