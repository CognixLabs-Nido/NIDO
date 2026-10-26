import { afterEach, describe, expect, it, vi } from 'vitest'

import { hoyMadrid, offsetDias } from '../fecha'

/**
 * El día de calendario en Madrid (lo que usan la ventana de edición y los tests de RLS que la
 * prueban) alrededor del cambio de hora. Los instantes se SIMULAN con el reloj falso: esperar a que
 * llegue el día del cambio deja el test sin dientes el resto del año.
 *
 * Restar 24 h a «ahora» no da ayer: el último domingo de octubre tiene 25 horas y, entre las 23:00
 * y las 24:00 de Madrid, «ahora − 24 h» sigue siendo hoy. En marzo el día tiene 23 y falla a los dos
 * lados del cambio: entre las 23:00 y las 24:00 del sábado, «ahora + 24 h» ya es el lunes, y entre
 * las 00:00 y las 01:00 del lunes, «ahora − 24 h» todavía es el sábado.
 */

const madrid = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d)

/** La fórmula que había en los tests: `Date.now() ± n × 24 h`, formateada en Madrid. */
const restando24h = (dias: number) => madrid(new Date(Date.now() + dias * 24 * 60 * 60 * 1000))

afterEach(() => {
  vi.useRealTimers()
})

describe('hoyMadrid y offsetDias en el cambio de hora', () => {
  it.each([
    // [instante UTC, hora en Madrid, hoy, ayer, mañana, el desplazamiento en que falla restar 24 h]
    ['2026-10-25T22:30:00Z', '23:30 del día de 25 h', '2026-10-25', '2026-10-24', '2026-10-26', -1],
    [
      '2026-03-28T22:30:00Z',
      '23:30 de la víspera del día de 23 h',
      '2026-03-28',
      '2026-03-27',
      '2026-03-29',
      1,
    ],
    [
      '2026-03-29T22:30:00Z',
      '00:30 del día siguiente al de 23 h',
      '2026-03-30',
      '2026-03-29',
      '2026-03-31',
      -1,
    ],
  ] as const)(
    'a las %s (%s), ayer y mañana son los del calendario',
    (instante, _h, hoy, ayer, manana, falla) => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(instante))

      // Premisa: el reloj falso está puesto y en este instante restar 24 h SÍ se equivoca. Sin esto,
      // el test pasaría igual con la fórmula mala si el instante no fuera el peligroso.
      expect(madrid(new Date())).toBe(hoy)
      expect(restando24h(falla)).not.toBe(falla < 0 ? ayer : manana)

      expect(hoyMadrid()).toBe(hoy)
      expect(offsetDias(hoyMadrid(), -1)).toBe(ayer)
      expect(offsetDias(hoyMadrid(), 1)).toBe(manana)
      expect(offsetDias(hoyMadrid(), 0)).toBe(hoy)
    }
  )

  it('cruza meses, años y los 30 días de una medicación que atraviesa el cambio', () => {
    expect(offsetDias('2026-03-01', -1)).toBe('2026-02-28')
    expect(offsetDias('2028-03-01', -1)).toBe('2028-02-29')
    expect(offsetDias('2026-12-31', 1)).toBe('2027-01-01')
    expect(offsetDias('2026-10-10', 30)).toBe('2026-11-09')
    expect(offsetDias('2026-03-15', 30)).toBe('2026-04-14')
  })
})
