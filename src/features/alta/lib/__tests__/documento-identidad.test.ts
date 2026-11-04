import { describe, expect, it } from 'vitest'

import { documentoValido, formaDocumento } from '../documento-identidad'

/**
 * «NIF o documento de identidad» del titular (0c-2, opción a del responsable): el dígito de
 * control solo se comprueba con forma española; un documento extranjero se acepta tal cual.
 * Los válidos son los ejemplos de siempre de cada forma (DNI 12345678Z, NIE X1234567L, CIF de
 * sociedad limitada B12345674); cada uno tiene a su lado el mismo con el control cambiado.
 */
describe('documentoValido', () => {
  it('reconoce la forma: DNI, NIE, CIF u otro', () => {
    for (const [doc, forma] of [
      ['12345678Z', 'dni'],
      ['12.345.678-z', 'dni'],
      ['X1234567L', 'nie'],
      ['Y-1234567-X', 'nie'],
      ['B12345674', 'cif'],
      ['Q2826000H', 'cif'],
      ['FR12AB34567', 'otro'],
      ['P1234567', 'otro'],
    ] as const) {
      expect.soft(formaDocumento(doc), doc).toBe(forma)
    }
  })

  it('con forma española, el control tiene que cuadrar (control positivo y negativo de cada una)', () => {
    for (const [bueno, malo] of [
      ['12345678Z', '12345678A'],
      ['12.345.678-z', '12.345.678-a'],
      ['X1234567L', 'X1234567A'],
      ['Y1234567X', 'Y1234567L'],
      ['Z1234567R', 'Z1234567T'],
      ['B12345674', 'B12345670'],
      ['B00000000', 'B00000001'],
      ['Q2826000H', 'Q2826000A'],
    ] as const) {
      expect.soft(documentoValido(bueno), bueno).toBe(true)
      expect.soft(documentoValido(malo), malo).toBe(false)
    }
  })

  it('una sociedad limitada lleva número; una entidad pública, letra', () => {
    // B12345674 con la letra del mismo control (D): no vale para una B.
    expect(documentoValido('B1234567D')).toBe(false)
    // Q2826000H con el número del mismo control (8): no vale para una Q.
    expect(documentoValido('Q28260008')).toBe(false)
  })

  it('un documento extranjero o un pasaporte se acepta tal cual', () => {
    for (const doc of ['FR12AB34567', 'P1234567', 'DE 1234 5678 9', 'AB123456']) {
      expect.soft(documentoValido(doc), doc).toBe(true)
    }
  })

  it('vacío, solo espacios o signos, o más de 40, no', () => {
    for (const doc of ['', '   ', '---', 'A'.repeat(41)]) {
      expect.soft(documentoValido(doc), JSON.stringify(doc)).toBe(false)
    }
    expect(documentoValido('A'.repeat(40))).toBe(true)
  })
})
