import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

import { renderRegistroLecturasHtml, type Etiquetador } from '../lib/registro-lecturas-html'
import type { LecturaFichaMedica } from '../queries/get-lecturas-ficha-medica'

/**
 * El registro que la Dirección descarga para entregar a la familia: por cada lectura, quién, la
 * fecha y la hora con su zona, y qué datos de la ficha consultó (art. 9 del Reglamento (UE)
 * 2025/327). El traductor lee los mensajes de verdad y lanza con una clave que falta, como
 * next-intl.
 */

function traductor(msgs: Record<string, unknown>): Etiquetador {
  return (key) => {
    let v: unknown = msgs.ficha_medica_lecturas
    for (const parte of key.split('.')) v = (v as Record<string, unknown> | undefined)?.[parte]
    if (typeof v !== 'string' || !v.trim()) throw new Error(`falta ficha_medica_lecturas.${key}`)
    return v
  }
}

const LECTURAS: LecturaFichaMedica[] = [
  {
    leidaEn: '2026-07-15T10:30:00Z',
    lector: 'Ana <b>Pérez</b> & Cía',
    rol: 'directora',
    origen: 'ficha',
    campos: ['alergias_graves', 'medicacion_habitual'],
  },
  {
    leidaEn: '2026-01-15T10:30:00Z',
    lector: null,
    rol: 'tutor_legal',
    origen: 'export',
    campos: [],
  },
]

const GENERADO = new Date('2026-10-27T15:00:00Z')

describe('registro de lecturas para entregar', () => {
  const html = renderRegistroLecturasHtml(
    { nino: 'Lucía Martín', generadoEn: GENERADO, lecturas: LECTURAS },
    traductor(es as Record<string, unknown>),
    'es'
  )
  const filas = html.split('<tr>').slice(2)

  it('una fila por lectura, con las columnas que pide el art. 9', () => {
    // Premisa: el documento lleva la tabla y su cabecera.
    expect(html).toContain('<th>Fecha y hora</th>')
    expect(html).toContain('<th>Quién accedió</th>')
    expect(html).toContain('<th>Datos consultados</th>')
    expect(filas).toHaveLength(2)
    expect(html).toContain('Lucía Martín')
  })

  it('la hora va en la de Madrid con su zona, y en UTC en el datetime', () => {
    expect(filas[0]).toContain(
      '<time datetime="2026-07-15T10:30:00.000Z">15/07/2026, 12:30:00 CEST</time>'
    )
    expect(filas[1]).toContain(
      '<time datetime="2026-01-15T10:30:00.000Z">15/01/2026, 11:30:00 CET</time>'
    )
  })

  it('quién, en calidad de qué, desde dónde y qué datos; el texto ajeno va escapado', () => {
    expect(filas[0]).toContain('Ana &lt;b&gt;Pérez&lt;/b&gt; &amp; Cía')
    expect(html).not.toContain('<b>Pérez</b>')
    expect(filas[0]).toContain('<td>Dirección</td>')
    expect(filas[0]).toContain('<td>desde la ficha del niño</td>')
    expect(filas[0]).toContain('<td>alergias graves, medicación habitual</td>')
    expect(filas[1]).toContain('<td>Cuenta borrada</td>')
    expect(filas[1]).toContain('<td>Tutor legal</td>')
    expect(filas[1]).toContain('<td>La ficha no tenía datos</td>')
  })

  it('sin lecturas lo dice, sin tabla vacía', () => {
    const vacio = renderRegistroLecturasHtml(
      { nino: 'Lucía Martín', generadoEn: GENERADO, lecturas: [] },
      traductor(es as Record<string, unknown>),
      'es'
    )
    expect(vacio).toContain('Nadie ha consultado todavía la ficha médica.')
    expect(vacio).not.toContain('<table>')
  })

  for (const [locale, msgs] of [
    ['en', en],
    ['va', va],
  ] as const) {
    it(`${locale}: el documento tiene todos sus textos`, () => {
      const doc = renderRegistroLecturasHtml(
        { nino: 'Lucía Martín', generadoEn: GENERADO, lecturas: LECTURAS },
        traductor(msgs as Record<string, unknown>),
        locale
      )
      expect(doc).toContain(`<html lang="${locale}">`)
      expect(doc.split('<tr>')).toHaveLength(4)
    })
  }
})
