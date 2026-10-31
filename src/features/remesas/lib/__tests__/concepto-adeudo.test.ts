import { describe, expect, it } from 'vitest'

import { MAX_CONCEPTO_SEPA, textoSepa } from '../generar-pain008'
import { conceptoAdeudo, conceptosDeRemesa, sinTildes } from '../concepto-adeudo'

/**
 * PR-0b de `docs/specs/altas-serie.md` (D9): el concepto del adeudo es «centro · niño · mes», sin
 * tildes, y cabe en 140 por una escalera decidida (cabecera de `concepto-adeudo.ts`), no por un
 * recorte. Las filas tienen la forma de producción: el recibo es de la familia (sin niño) y el
 * niño sale de sus líneas; hay un recibo con dos hermanos.
 */

const R1 = '0d06ffd1-d24e-4d6e-b1db-341d6c94bb26'
const R2 = '290f1adf-67ab-4273-af32-4b9d4cb39323'
const N1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const N2 = 'aaaaaaaa-0000-4000-8000-000000000002'

const CENTRO_LARGO = 'Centro de Educación Infantil Els Xiquets de Benimaclet'
const APELLIDOS_LARGOS = 'Fernández-Villaverde Martínez'
const CUATRO_HERMANOS = [
  { nombre: 'María del Carmen', apellidos: APELLIDOS_LARGOS },
  { nombre: 'Juan Sebastián', apellidos: APELLIDOS_LARGOS },
  { nombre: 'Ana Isabel', apellidos: APELLIDOS_LARGOS },
  { nombre: 'Pablo', apellidos: APELLIDOS_LARGOS },
]

/** Todas las palabras del concepto salen enteras de lo que entró: ninguna cortada por la mitad. */
function palabrasEnteras(concepto: string, entradas: string[]): boolean {
  const validas = new Set(
    entradas.flatMap((e) => sinTildes(e).split(/[\s,]+/)).concat(['·', 'y', 'más'])
  )
  return concepto
    .split(/[\s,]+/)
    .filter(Boolean)
    .every((p) => validas.has(p) || /^\d+$/.test(p))
}

describe('conceptoAdeudo', () => {
  it('centro · niño · mes, sin tildes', () => {
    expect(
      conceptoAdeudo({
        centro: 'CEI Ejemplo',
        ninos: [{ nombre: 'Lucía', apellidos: 'Demo Pruebas' }],
        anio: 2026,
        mes: 10,
      })
    ).toBe('CEI Ejemplo · Lucia Demo Pruebas · Octubre 2026')
  })

  it('dos hermanos van los dos, en orden, con nombre y apellidos', () => {
    expect(
      conceptoAdeudo({
        centro: 'CEI Ejemplo',
        ninos: [
          { nombre: 'Pablo', apellidos: 'Demo' },
          { nombre: 'Ana', apellidos: 'Demo' },
        ],
        anio: 2026,
        mes: 1,
      })
    ).toBe('CEI Ejemplo · Ana Demo y Pablo Demo · Enero 2026')
  })

  it('sin niño en las líneas, centro y mes', () => {
    expect(conceptoAdeudo({ centro: 'CEI Ejemplo', ninos: [], anio: 2026, mes: 12 })).toBe(
      'CEI Ejemplo · Diciembre 2026'
    )
  })

  it('el centro largo cabe entero si hay sitio', () => {
    expect(
      conceptoAdeudo({
        centro: CENTRO_LARGO,
        ninos: [{ nombre: 'Lucía', apellidos: 'Demo Pruebas' }],
        anio: 2026,
        mes: 9,
      })
    ).toBe(
      'Centro de Educacion Infantil Els Xiquets de Benimaclet · Lucia Demo Pruebas · Septiembre 2026'
    )
  })

  it('premisa: cuatro hermanos con apellidos largos y el centro largo no caben enteros', () => {
    const entero = [
      sinTildes(CENTRO_LARGO),
      CUATRO_HERMANOS.map((n) => `${n.nombre} ${n.apellidos}`).join(', '),
      'Septiembre 2026',
    ].join(' · ')
    expect(entero.length).toBeGreaterThan(MAX_CONCEPTO_SEPA)
  })

  it('cuatro hermanos con los mismos apellidos: los nombres y los apellidos una vez', () => {
    const c = conceptoAdeudo({ centro: CENTRO_LARGO, ninos: CUATRO_HERMANOS, anio: 2026, mes: 9 })
    // Con el centro entero serían 162: los apellidos van una vez y cede el centro.
    expect(c).toBe(
      'Centro de Educacion Infantil · Ana Isabel, Juan Sebastian, Maria del Carmen y Pablo ' +
        'Fernandez-Villaverde Martinez · Septiembre 2026'
    )
    expect(c.length).toBeLessThanOrEqual(MAX_CONCEPTO_SEPA)
  })

  it('apellidos distintos que no caben: el centro se acorta por palabras antes que los niños', () => {
    const c = conceptoAdeudo({
      centro: CENTRO_LARGO,
      ninos: [
        { nombre: 'María del Carmen', apellidos: 'Fernández-Villaverde Martínez' },
        { nombre: 'Juan Sebastián', apellidos: 'Gómez de la Serna' },
      ],
      anio: 2026,
      mes: 9,
    })
    // Con el centro entero serían 156: cede el centro, y los dos niños van con sus apellidos.
    expect(c).toBe(
      'Centro de Educacion Infantil · Juan Sebastian Gomez de la Serna y ' +
        'Maria del Carmen Fernandez-Villaverde Martinez · Septiembre 2026'
    )
    expect(c.length).toBeLessThanOrEqual(MAX_CONCEPTO_SEPA)
  })

  it('si ni así caben, solo los nombres', () => {
    const c = conceptoAdeudo({
      centro: CENTRO_LARGO,
      ninos: CUATRO_HERMANOS.map((n, i) => ({ ...n, apellidos: `${n.apellidos} ${i}` })),
      anio: 2026,
      mes: 9,
    })
    expect(c).toBe(
      'Centro de Educacion Infantil Els Xiquets de Benimaclet · Ana Isabel, Juan Sebastian, ' +
        'Maria del Carmen y Pablo · Septiembre 2026'
    )
  })

  it('y si tampoco caben los nombres: los que quepan y «y N más», con el mes siempre', () => {
    const ninos = Array.from({ length: 9 }, (_, i) => ({
      nombre: `Bartolomé Maximiliano ${String.fromCharCode(65 + i)}`,
      apellidos: `Apellido${i}`,
    }))
    const c = conceptoAdeudo({ centro: CENTRO_LARGO, ninos, anio: 2026, mes: 9 })
    expect(c).toMatch(
      /^Centro de Educacion Infantil · Bartolome Maximiliano A, .* y \d+ más · Septiembre 2026$/
    )
    expect(c.length).toBeLessThanOrEqual(MAX_CONCEPTO_SEPA)
  })

  it('en todos los casos: cabe en 140 y ninguna palabra sale cortada', () => {
    const casos = [
      { centro: CENTRO_LARGO, ninos: CUATRO_HERMANOS },
      { centro: `${CENTRO_LARGO} ${CENTRO_LARGO}`, ninos: CUATRO_HERMANOS.slice(0, 1) },
      {
        centro: CENTRO_LARGO,
        ninos: Array.from({ length: 12 }, (_, i) => ({
          nombre: `Nombre${i} Compuesto`,
          apellidos: `Apellido${i} Otro${i}`,
        })),
      },
    ]
    for (const caso of casos) {
      const c = conceptoAdeudo({ ...caso, anio: 2026, mes: 9 })
      expect(c.length).toBeLessThanOrEqual(MAX_CONCEPTO_SEPA)
      expect(textoSepa(c).length).toBeLessThanOrEqual(MAX_CONCEPTO_SEPA)
      const entradas = [
        caso.centro,
        'Septiembre 2026',
        ...caso.ninos.flatMap((n) => [n.nombre, n.apellidos]),
      ]
      expect(palabrasEnteras(c, entradas)).toBe(true)
    }
  })

  it('el · se queda en el concepto; el fichero lo escribe con guion (no igualarlos)', () => {
    const c = conceptoAdeudo({
      centro: 'CEI Ejemplo',
      ninos: [{ nombre: 'Lucía', apellidos: 'Demo' }],
      anio: 2026,
      mes: 10,
    })
    expect(c).toContain(' · ')
    expect(textoSepa(c)).toBe('CEI Ejemplo - Lucia Demo - Octubre 2026')
  })

  it('sinTildes quita también la eñe y la diéresis', () => {
    expect(sinTildes('Begoña Güell Álvarez')).toBe('Begona Guell Alvarez')
  })
})

describe('conceptosDeRemesa', () => {
  const ninos = [
    { id: N1, nombre: 'Niña', apellidos: 'Demo Uno' },
    { id: N2, nombre: 'Niño', apellidos: 'Demo Dos' },
  ]

  it('cada recibo con los niños de sus líneas, sin repetir; los dos hermanos en el mismo', () => {
    const m = conceptosDeRemesa(
      'CEI Ejemplo',
      [
        { id: R1, anio: 2026, mes: 10 },
        { id: R2, anio: 2026, mes: 10 },
      ],
      [
        { recibo_id: R1, nino_id: N1 },
        { recibo_id: R1, nino_id: N1 },
        { recibo_id: R1, nino_id: N2 },
        { recibo_id: R1, nino_id: null },
        { recibo_id: R2, nino_id: N2 },
      ],
      ninos
    )
    expect(m.get(R1)).toBe('CEI Ejemplo · Nina Demo Uno y Nino Demo Dos · Octubre 2026')
    expect(m.get(R2)).toBe('CEI Ejemplo · Nino Demo Dos · Octubre 2026')
  })

  it('un recibo sin líneas con niño sale igual, con centro y mes', () => {
    const m = conceptosDeRemesa('CEI Ejemplo', [{ id: R1, anio: 2026, mes: 7 }], [], ninos)
    expect([...m.keys()]).toEqual([R1])
    expect(m.get(R1)).toBe('CEI Ejemplo · Julio 2026')
  })
})
