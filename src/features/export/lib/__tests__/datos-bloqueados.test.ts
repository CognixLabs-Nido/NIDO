// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { DATOS_BLOQUEADOS, datosBloqueadosEnExport } from '../recolectar'

/**
 * Lo bloqueado tras la purga (20261205120000) sale en el export como una nota: qué hay, cuánto y
 * desde cuándo. Los códigos los escribe la BD (`privado.datos_bloqueados`) y la app les pone
 * etiqueta: este test lee los de la última migración que define la función.
 */

const MIGRACIONES = path.resolve(__dirname, '../../../../../supabase/migrations')
const ANCLA = /CREATE (?:OR REPLACE )?FUNCTION privado\.datos_bloqueados\(/
const FICHERO = readdirSync(MIGRACIONES)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .filter((f) => ANCLA.test(readFileSync(path.join(MIGRACIONES, f), 'utf8')))
  .at(-1)
const FUNCION = (() => {
  if (!FICHERO) return ''
  const sql = readFileSync(path.join(MIGRACIONES, FICHERO), 'utf8')
  const desde = sql.search(ANCLA)
  const cuerpo = sql.indexOf('$function$', desde)
  return sql.slice(desde, sql.indexOf('$function$', cuerpo + 1))
})()

describe('export: los datos bloqueados', () => {
  it('la app pone etiqueta exactamente a los códigos de la migración', () => {
    // Premisa: la función entera, no un trozo.
    expect(FUNCION).toMatch(/^CREATE FUNCTION privado\.datos_bloqueados\(/)
    expect(FUNCION).toContain('GROUP BY codigo')
    const codigos = [...new Set([...FUNCION.matchAll(/SELECT '(\w+)',/g)].map((m) => m[1]!))]
    expect(codigos.length).toBeGreaterThan(0)
    expect(codigos.sort()).toEqual(Object.keys(DATOS_BLOQUEADOS).sort())
  })

  it('nada bloqueado, o lo que no tiene forma, no da nota', () => {
    expect(datosBloqueadosEnExport(null)).toBeNull()
    expect(datosBloqueadosEnExport([])).toBeNull()
    expect(datosBloqueadosEnExport([{ codigo: 'firmas' }])).toBeNull()
  })

  it('un código sin etiqueta sale con su código, no callado', () => {
    const nota = datosBloqueadosEnExport([{ codigo: 'nuevo_dato', n: 1, desde: '2027-01-02' }])
    expect(nota?._nota).toContain('nuevo_dato (1, desde el 02/01/2027)')
    expect(nota?.bloqueados_desde).toBe('2027-01-02')
  })

  it('la fecha de la nota es la más antigua; sin fechas, no la inventa', () => {
    const nota = datosBloqueadosEnExport([
      { codigo: 'recibos', n: 3, desde: '2027-05-01' },
      { codigo: 'mandatos_sepa', n: 1, desde: '2027-04-01' },
    ])
    expect(nota?.bloqueados_desde).toBe('2027-04-01')
    expect(datosBloqueadosEnExport([{ codigo: 'recibos', n: 3, desde: null }])).not.toHaveProperty(
      'bloqueados_desde'
    )
  })
})
