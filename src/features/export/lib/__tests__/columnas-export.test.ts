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
    const noSalen = Object.values(catalogo).flatMap((s) =>
      Object.values(s.columnas).filter((d) => 'noSale' in d)
    )
    // Premisa: hay «no sale» que mirar (los de recibos, al menos).
    expect(noSalen.length).toBeGreaterThanOrEqual(8)
    for (const [ruta, s] of Object.entries(catalogo)) {
      for (const [col, d] of Object.entries(s.columnas)) {
        if ('noSale' in d) {
          expect(d.noSale.trim().length, `${ruta}.${col}`).toBeGreaterThanOrEqual(40)
          // El marcador de relleno es «TODO» en mayúsculas y como palabra: «todos» es castellano.
          expect(d.noSale, `${ruta}.${col}`).not.toMatch(/\bTODO\b/)
          expect(d.noSale, `${ruta}.${col}`).not.toMatch(/pendiente|por decidir/i)
        }
      }
    }
  })

  it('las reglas R1-R7 se cumplen en todo el catálogo, también en las columnas que lleguen', () => {
    // La clase se saca aquí del nombre, sin mirar el catálogo: así una decisión cambiada a mano
    // contra su regla se pone roja, y una columna nueva de una clase técnica hereda su regla.
    const PERSONA =
      /(^|_)(autor|firmante|usuario|usuario_destinatario|tutor_usuario|lector|organizador)_id$|_por$|^created_by$|^tutores_legales$/
    const SECRETO = new Set(['token', 'endpoint', 'p256dh', 'auth'])
    const tipo = (d: DecisionColumna) =>
      'sale' in d ? 'sale' : 'noSale' in d ? 'noSale' : 'porDecidir'
    let n = 0
    for (const [ruta, s] of Object.entries(catalogo))
      for (const [c, d] of Object.entries(s.columnas)) {
        const t = tipo(d)
        const donde = `${ruta}.${c}`
        if (['created_at', 'updated_at', 'deleted_at'].includes(c)) {
          expect(t, `R1/R2 ${donde}`).toBe('sale')
        } else if (c === 'deleted_reason') {
          expect(t, `R2 ${donde}`).toBe('sale')
        } else if (c === 'centro_id') {
          expect(t, `R3 ${donde}`).toBe('noSale')
        } else if (SECRETO.has(c)) {
          expect(t, `R6 ${donde}`).toBe('noSale')
        } else if (PERSONA.test(c)) {
          // Puede salir algo calculado con ella, nunca el uuid: entonces lo dice su nota.
          if (t === 'sale') expect('sale' in d && d.nota, `R4 ${donde}: sale sin nota`).toBeTruthy()
          else expect(t, `R4 ${donde}`).toBe('noSale')
        } else if (c === 'id' || c.endsWith('_id')) {
          expect(['sale', 'noSale'], `R5 ${donde}`).toContain(t)
        } else if (c === 'ip_address' || c === 'user_agent') {
          expect(t, `R7 ${donde}`).toBe(ruta === 'nino.consentimientos' ? 'noSale' : 'sale')
        } else if (['texto_hash', 'texto_version', 'metodo_firma'].includes(c)) {
          expect(t, `R7 ${donde}`).toBe('sale')
        } else continue
        n++
      }
    // Premisa: las reglas alcanzan las técnicas del catálogo (las 207 del 2026-11-01 y las que ya
    // estaban decididas antes).
    expect(n).toBeGreaterThan(207)
  })

  it('recibos está decidida entera: ninguna columna por decidir', () => {
    const recibos = catalogo['usuario.cobros_familia.recibos']
    // Premisa: es la sección de recibos, con sus columnas.
    expect(recibos.tabla).toBe('recibos')
    expect(Object.keys(recibos.columnas).length).toBeGreaterThan(20)
    expect(Object.entries(recibos.columnas).filter(([, d]) => 'porDecidir' in d)).toEqual([])
    // R1 y R2 sustituyen a la decisión del #467 (que las dejaba fuera), y cada una lo dice, con fecha.
    for (const c of ['created_at', 'updated_at', 'deleted_at']) {
      const d = recibos.columnas[c]
      expect('sale' in d && d.nota, c).toMatch(/#467/)
      expect('sale' in d && d.nota, c).toMatch(/2026-11-01/)
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
