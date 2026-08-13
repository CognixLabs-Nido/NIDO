import { describe, expect, it } from 'vitest'

import { componerResumenRecalculo, type RecalculoResumen } from '../resumen-recalculo'

const BASE: RecalculoResumen = {
  conceptosSembrados: 0,
  ninosAfectados: 0,
  familiasAfectadas: 0,
  recibosRegenerados: 0,
  confirmadosIntactos: 0,
}

const claves = (r: RecalculoResumen) => componerResumenRecalculo(r).map((f) => f.clave)

describe('componerResumenRecalculo (R-1)', () => {
  it('el caso que motivó R-1: sin nada que sembrar NO dice "0", lo dice en palabras', () => {
    // El botón viejo devolvía un entero pelado y el toast mostraba "0", que Jose leía
    // como "no funciona". Aquí ese caso tiene frase propia.
    const frases = componerResumenRecalculo({ ...BASE, recibosRegenerados: 5 })
    expect(frases[0]).toEqual({ clave: 'recalculo_conceptos_ninguno' })
    expect(frases[0]!.valores).toBeUndefined()
  })

  it('reporta conceptos y a cuántos niños fueron', () => {
    const frases = componerResumenRecalculo({
      ...BASE,
      conceptosSembrados: 3,
      ninosAfectados: 2,
    })
    expect(frases[0]).toEqual({
      clave: 'recalculo_conceptos',
      valores: { conceptos: 3, ninos: 2 },
    })
  })

  it('omite el desglose por familias cuando no hubo ninguna', () => {
    // Un "0 familias" es ruido: el catálogo puede no tener conceptos de ámbito familia.
    expect(claves({ ...BASE, conceptosSembrados: 2, ninosAfectados: 1 })).not.toContain(
      'recalculo_familias'
    )
  })

  it('incluye las familias cuando sí las hubo', () => {
    const frases = componerResumenRecalculo({
      ...BASE,
      conceptosSembrados: 4,
      ninosAfectados: 2,
      familiasAfectadas: 1,
    })
    expect(frases[1]).toEqual({ clave: 'recalculo_familias', valores: { familias: 1 } })
  })

  it('SIEMPRE nombra los confirmados intactos, incluso en cero', () => {
    // Es la garantía que el usuario necesita leer; en 0 significa "no había ninguno".
    for (const confirmados of [0, 2]) {
      const frases = componerResumenRecalculo({ ...BASE, confirmadosIntactos: confirmados })
      expect(frases.at(-1)).toEqual({
        clave: 'recalculo_confirmados',
        valores: { confirmados },
      })
    }
  })

  it('siempre nombra los recibos regenerados', () => {
    expect(claves({ ...BASE, recibosRegenerados: 5 })).toContain('recalculo_recibos')
    expect(claves(BASE)).toContain('recalculo_recibos')
  })

  it('el caso completo va en orden: conceptos · familias · recibos · confirmados', () => {
    expect(
      claves({
        conceptosSembrados: 4,
        ninosAfectados: 2,
        familiasAfectadas: 1,
        recibosRegenerados: 5,
        confirmadosIntactos: 2,
      })
    ).toEqual([
      'recalculo_conceptos',
      'recalculo_familias',
      'recalculo_recibos',
      'recalculo_confirmados',
    ])
  })

  it('ninguna frase queda sin decir algo: nunca se devuelve una lista vacía', () => {
    expect(componerResumenRecalculo(BASE).length).toBeGreaterThan(0)
  })
})
