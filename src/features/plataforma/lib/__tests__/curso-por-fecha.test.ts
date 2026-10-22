import { describe, expect, it } from 'vitest'

import { cursoPorFecha } from '../curso-por-fecha'

/** El curso va del 1 de septiembre al 31 de julio; desde agosto se propone el que empieza. */
describe('cursoPorFecha', () => {
  it.each([
    ['2026-10-22', '2026-27', '2026-09-01', '2027-07-31'],
    ['2027-07-31', '2026-27', '2026-09-01', '2027-07-31'],
    ['2027-08-01', '2027-28', '2027-09-01', '2028-07-31'],
    ['2027-01-15', '2026-27', '2026-09-01', '2027-07-31'],
    ['2099-09-01', '2099-00', '2099-09-01', '2100-07-31'],
  ])('%s → %s', (hoy, nombre, inicio, fin) => {
    expect(cursoPorFecha(hoy)).toEqual({ nombre, inicio, fin })
  })
})
