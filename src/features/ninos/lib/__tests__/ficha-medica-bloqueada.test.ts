import { describe, expect, it } from 'vitest'

import { fichaMedicaBloqueadaDesde } from '../ficha-medica-bloqueada'

/**
 * El error de la ficha bloqueada (20261204120000): 55000 con la fecha en DETAIL. Cualquier otro
 * error no es el bloqueo, aunque comparta código: así un «no autorizado» no se pinta como
 * «bloqueada» ni al revés.
 */
describe('fichaMedicaBloqueadaDesde', () => {
  it('lee la fecha del bloqueo', () => {
    expect(fichaMedicaBloqueadaDesde({ code: '55000', details: '2026-08-01' })).toBe('2026-08-01')
  })

  it('otro código, aunque traiga una fecha, no es el bloqueo', () => {
    expect(fichaMedicaBloqueadaDesde({ code: 'P0001', details: '2026-08-01' })).toBeNull()
  })

  it('55000 sin una fecha en DETAIL no es el bloqueo: no se inventa la fecha', () => {
    expect(fichaMedicaBloqueadaDesde({ code: '55000', details: null })).toBeNull()
    expect(fichaMedicaBloqueadaDesde({ code: '55000', details: 'otra cosa' })).toBeNull()
    expect(fichaMedicaBloqueadaDesde({ code: '55000' })).toBeNull()
  })

  it('sin error, nada', () => {
    expect(fichaMedicaBloqueadaDesde(null)).toBeNull()
  })
})
