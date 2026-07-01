import { describe, expect, it } from 'vitest'

import { escaparCelda, generarCsv } from '../export-csv'

const BOM = '﻿'

describe('escaparCelda', () => {
  it('deja intactos los valores simples', () => {
    expect(escaparCelda('Ana')).toBe('Ana')
    expect(escaparCelda(42)).toBe('42')
  })

  it('entrecomilla y dobla comillas cuando hay coma, comilla o salto de línea', () => {
    expect(escaparCelda('50,00')).toBe('"50,00"')
    expect(escaparCelda('a"b')).toBe('"a""b"')
    expect(escaparCelda('línea1\nlínea2')).toBe('"línea1\nlínea2"')
  })
})

describe('generarCsv', () => {
  it('antepone BOM y separa filas con CRLF, campos con coma', () => {
    const csv = generarCsv([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(csv).toBe(`${BOM}a,b\r\nc,d`)
  })

  it('escapa importes con coma decimal para que no colisionen con el separador', () => {
    const csv = generarCsv([['Total', '55,00']])
    expect(csv).toBe(`${BOM}Total,"55,00"`)
  })
})
