import { describe, expect, it } from 'vitest'

import { mesSiguiente, repartirExceso, type BecaNino } from '../lib/reparto-desborde'

describe('repartirExceso', () => {
  const sumar = (rs: { restoCentimos: number }[]) => rs.reduce((a, r) => a + r.restoCentimos, 0)

  it('reparto proporcional exacto cuando divide bien', () => {
    // exceso 900, dos hijos 30€/60€ → 1:2 → 300 / 600
    const becas: BecaNino[] = [
      { ninoId: 'a', becaCentimos: 3000 },
      { ninoId: 'b', becaCentimos: 6000 },
    ]
    const r = repartirExceso(900, becas)
    expect(r).toEqual([
      { ninoId: 'a', restoCentimos: 300 },
      { ninoId: 'b', restoCentimos: 600 },
    ])
    expect(sumar(r)).toBe(900)
  })

  it('suma EXACTA aunque el redondeo no cuadre (resto mayor)', () => {
    // exceso 100, tres hijos iguales → 33.33.. → 34/33/33 sumando 100
    const becas: BecaNino[] = [
      { ninoId: 'a', becaCentimos: 1000 },
      { ninoId: 'b', becaCentimos: 1000 },
      { ninoId: 'c', becaCentimos: 1000 },
    ]
    const r = repartirExceso(100, becas)
    expect(sumar(r)).toBe(100)
    expect(r.map((x) => x.restoCentimos).sort((a, b) => b - a)).toEqual([34, 33, 33])
  })

  it('desempate determinista por ninoId asc', () => {
    // exceso 1, dos hijos iguales → el céntimo va al ninoId menor
    const r = repartirExceso(1, [
      { ninoId: 'b', becaCentimos: 500 },
      { ninoId: 'a', becaCentimos: 500 },
    ])
    expect(r).toEqual([{ ninoId: 'a', restoCentimos: 1 }])
    expect(sumar(r)).toBe(1)
  })

  it('un solo hijo con beca se lleva todo el exceso', () => {
    const r = repartirExceso(1234, [
      { ninoId: 'a', becaCentimos: 5000 },
      { ninoId: 'b', becaCentimos: 0 },
    ])
    expect(r).toEqual([{ ninoId: 'a', restoCentimos: 1234 }])
  })

  it('reparto ponderado con arrastre exacto', () => {
    // exceso 1000, becas 1500/3500/5000 (total 10000) → 150/350/500 = 1000
    const r = repartirExceso(1000, [
      { ninoId: 'a', becaCentimos: 1500 },
      { ninoId: 'b', becaCentimos: 3500 },
      { ninoId: 'c', becaCentimos: 5000 },
    ])
    expect(sumar(r)).toBe(1000)
    expect(r).toEqual([
      { ninoId: 'a', restoCentimos: 150 },
      { ninoId: 'b', restoCentimos: 350 },
      { ninoId: 'c', restoCentimos: 500 },
    ])
  })

  it('exceso 0 o sin beca → sin reparto', () => {
    expect(repartirExceso(0, [{ ninoId: 'a', becaCentimos: 100 }])).toEqual([])
    expect(repartirExceso(100, [])).toEqual([])
    expect(repartirExceso(100, [{ ninoId: 'a', becaCentimos: 0 }])).toEqual([])
  })
})

describe('mesSiguiente', () => {
  it('mes normal', () => {
    expect(mesSiguiente(2026, 9)).toEqual({ anio: 2026, mes: 10 })
  })
  it('diciembre cruza a enero del año siguiente', () => {
    expect(mesSiguiente(2026, 12)).toEqual({ anio: 2027, mes: 1 })
  })
})
