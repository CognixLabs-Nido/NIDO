import { describe, expect, it } from 'vitest'

import { SECCIONES_EXPORT, type DecisionColumna } from '../columnas-export'
import { POR_DECIDIR_2026_11_01 } from './por-decidir-2026-11-01'
import { cuerpoDelExport, seccionesDelExport, ultimaMigracionDelExport } from './secciones-export'

/**
 * La red del export art. 15, contra el export de verdad (la última migración que lo define): cada
 * columna que el catálogo dice que sale, sale, con esa clave; ninguna sale sin estar en él; cada
 * «no sale» lleva su porqué; y lo que está por decidir solo mengua.
 *
 * Que las columnas del catálogo son las de la base de verdad lo prueba `export-columnas.rls.test.ts`.
 */

const leidas = seccionesDelExport()
const catalogo = SECCIONES_EXPORT as Record<
  string,
  { tabla: string; columnas: Record<string, DecisionColumna> }
>

describe('la red del export: el catálogo y el export de verdad', () => {
  it('premisa: lee el export de la última migración, y todas sus secciones', () => {
    expect(ultimaMigracionDelExport()).toMatch(/^\d{14}_.*\.sql$/)
    // Cada fila del export es un jsonb_agg(jsonb_build_object(…)): las tiene que haber leído todas.
    const filas = cuerpoDelExport().match(/jsonb_agg\(\s*jsonb_build_object\(/g) ?? []
    expect(Object.keys(leidas)).toHaveLength(filas.length)
    expect(filas.length).toBeGreaterThan(30)
  })

  it('las secciones del export son las del catálogo, con su tabla', () => {
    expect(Object.keys(catalogo).sort()).toEqual(Object.keys(leidas).sort())
    for (const [ruta, s] of Object.entries(leidas)) expect(catalogo[ruta].tabla, ruta).toBe(s.tabla)
  })

  it('lo que el catálogo dice que sale es lo que sale, con su clave, y nada más', () => {
    for (const [ruta, s] of Object.entries(leidas)) {
      const salen = Object.fromEntries(
        Object.entries(catalogo[ruta].columnas).flatMap(([col, d]) =>
          'sale' in d ? [[col, d.sale]] : []
        )
      )
      expect(salen, ruta).toEqual(s.salen)
    }
  })

  it('cada columna que no sale a propósito lleva su porqué', () => {
    for (const [ruta, s] of Object.entries(catalogo)) {
      for (const [col, d] of Object.entries(s.columnas)) {
        if ('noSale' in d) {
          expect(d.noSale.trim().length, `${ruta}.${col}`).toBeGreaterThanOrEqual(40)
          expect(d.noSale, `${ruta}.${col}`).not.toMatch(/TODO|pendiente|por decidir/i)
        }
      }
    }
  })

  it('lo que está por decidir es lo que había el 2026-11-01, y solo mengua', () => {
    const ahora = Object.entries(catalogo).flatMap(([ruta, s]) =>
      Object.entries(s.columnas).flatMap(([col, d]) =>
        'porDecidir' in d ? [`${ruta}.${col}`] : []
      )
    )
    // Una columna nueva no puede entrar como «por decidir»: se decide al añadirla.
    const nuevas = ahora.filter((c) => !POR_DECIDIR_2026_11_01.includes(c))
    expect(nuevas).toEqual([])
    // Y la lista fechada no lleva lo ya decidido: al decidir, se quita de ella.
    const decididas = POR_DECIDIR_2026_11_01.filter((c) => !ahora.includes(c))
    expect(decididas).toEqual([])
    console.warn(`export art. 15: ${ahora.length} columnas por decidir`)
  })
})
