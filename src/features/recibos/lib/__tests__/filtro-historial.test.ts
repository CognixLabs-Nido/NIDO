import { describe, expect, it } from 'vitest'

import { hrefHistorial, leerFiltroHistorial } from '../filtro-historial'

/** F-6 — los filtros del histórico general, en la URL. */

const FAMILIA = '11111111-1111-4111-8111-111111111111'
const NINO = '22222222-2222-4222-8222-222222222222'

describe('filtros del histórico general', () => {
  it('lee los que valen', () => {
    expect(
      leerFiltroHistorial({ anio: '2026', mes: '3', familia: FAMILIA, nino: NINO, pagina: '4' })
    ).toEqual({ anio: 2026, mes: 3, familiaId: FAMILIA, ninoId: NINO, pagina: 4 })
  })

  it('lo que no vale no filtra: nunca llega a la consulta', () => {
    expect(
      leerFiltroHistorial({
        anio: '1999',
        mes: '13',
        familia: "x' or 1=1",
        nino: `${NINO},id.in.(otro)`,
        pagina: '-2',
      })
    ).toEqual({ anio: null, mes: null, familiaId: null, ninoId: null, pagina: 1 })
    expect(leerFiltroHistorial({})).toEqual({
      anio: null,
      mes: null,
      familiaId: null,
      ninoId: null,
      pagina: 1,
    })
  })

  it('la URL lleva solo lo que filtra, y la primera página sin número', () => {
    const base = '/es/admin/recibos'
    expect(hrefHistorial(base, leerFiltroHistorial({}))).toBe(base)
    expect(
      hrefHistorial(base, { anio: 2026, mes: null, familiaId: FAMILIA, ninoId: null, pagina: 2 })
    ).toBe(`${base}?anio=2026&familia=${FAMILIA}&pagina=2`)
  })
})
