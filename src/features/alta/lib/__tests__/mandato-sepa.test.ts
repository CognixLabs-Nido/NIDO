import { describe, expect, it } from 'vitest'

import {
  MAX_LARGO_IDENTIFICADOR,
  MAX_LARGO_ID_SEPA,
  generarIdentificadorMandato,
  textoCanonicoMandato,
  textoCanonicoMandatoV2,
} from '../mandato-sepa'

const CENTRO = '11111111-2222-4333-8444-555555555555'
const TUTOR = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

describe('generarIdentificadorMandato', () => {
  it('sigue el formato NIDO-{centroCorto}-{tutorCorto}-{ts en base 36} y cabe en la columna', () => {
    const id = generarIdentificadorMandato(CENTRO, TUTOR, 1750000000000)
    expect(id).toBe('NIDO-11111111-AAAAAAAA-MBXSTDZ4')
    expect(id.length).toBeLessThanOrEqual(MAX_LARGO_IDENTIFICADOR)
  })

  it('cabe en el MndtId del fichero (Max35), hoy y con cualquier timestamp', () => {
    // Premisa: el formato de antes, el de los 3 mandatos de producción, medía 36 y no cabía.
    expect(`NIDO-11111111-AAAAAAAA-${1784546999227}`.length).toBe(36)
    expect(MAX_LARGO_ID_SEPA).toBe(35)
    for (const ts of [Date.UTC(2026, 9, 31), Date.UTC(2100, 0, 1), Number.MAX_SAFE_INTEGER]) {
      expect(generarIdentificadorMandato(CENTRO, TUTOR, ts).length).toBeLessThanOrEqual(
        MAX_LARGO_ID_SEPA
      )
    }
  })

  it('cambia con el timestamp (unicidad por firma)', () => {
    expect(generarIdentificadorMandato(CENTRO, TUTOR, 1)).not.toBe(
      generarIdentificadorMandato(CENTRO, TUTOR, 2)
    )
  })
})

describe('textoCanonicoMandato', () => {
  const base = {
    identificadorMandato: 'NIDO-A-B-1',
    iban: 'es91 2100 0418 4502 0005 1332',
    titular: '  Tutor Demo  ',
    acreedorNombre: 'Escuela Demo',
    fechaFirmaIso: '2026-06-26T10:11:12.000Z',
  }

  it('normaliza IBAN, recorta titular y usa solo la fecha (estable cross-idioma)', () => {
    expect(textoCanonicoMandato(base)).toBe(
      'SEPA-CORE-MANDATE|id=NIDO-A-B-1|iban=ES9121000418450200051332|titular=Tutor Demo|acreedor=Escuela Demo|tipo=recurrente|fecha=2026-06-26'
    )
  })

  it('es determinista para la misma fecha aunque cambie la hora', () => {
    const a = textoCanonicoMandato(base)
    const b = textoCanonicoMandato({ ...base, fechaFirmaIso: '2026-06-26T23:59:59.000Z' })
    expect(a).toBe(b)
  })
})

describe('textoCanonicoMandatoV2 (0c-2)', () => {
  const v2 = {
    identificadorMandato: 'NIDO-A-B-1',
    iban: 'es91 2100 0418 4502 0005 1332',
    titular: '  Tutor Demo  ',
    acreedorNombre: 'Escuela Demo',
    fechaFirmaIso: '2026-06-26T10:11:12.000Z',
    acreedorCid: 'ES81ZZZB00000000',
    titularDocumento: ' 12345678Z ',
    titularDireccion: ' Calle Demo 1, Valencia ',
  }

  it('lleva la versión, el CID y el documento y la dirección del titular, en un orden fijo', () => {
    expect(textoCanonicoMandatoV2(v2)).toBe(
      'SEPA-CORE-MANDATE-V2|id=NIDO-A-B-1|iban=ES9121000418450200051332|titular=Tutor Demo|titular_documento=12345678Z|titular_direccion=Calle Demo 1, Valencia|acreedor=Escuela Demo|acreedor_cid=ES81ZZZB00000000|tipo=recurrente|fecha=2026-06-26'
    )
  })

  it('cambia con cada dato del v2: el CID, el documento y la dirección del titular', () => {
    const t = textoCanonicoMandatoV2(v2)
    for (const cambio of [
      { acreedorCid: 'ES80ZZZB00000000' },
      { titularDocumento: '12345678A' },
      { titularDireccion: 'Otra Calle 2' },
    ]) {
      expect.soft(textoCanonicoMandatoV2({ ...v2, ...cambio }), JSON.stringify(cambio)).not.toBe(t)
    }
  })

  it('no es el v1, y el v1 no cambia con los datos nuevos', () => {
    expect(textoCanonicoMandatoV2(v2).startsWith('SEPA-CORE-MANDATE-V2|')).toBe(true)
    // El v1 de los mismos datos es el de siempre: los mandatos firmados recalculan con él.
    expect(textoCanonicoMandato(v2)).toBe(
      'SEPA-CORE-MANDATE|id=NIDO-A-B-1|iban=ES9121000418450200051332|titular=Tutor Demo|acreedor=Escuela Demo|tipo=recurrente|fecha=2026-06-26'
    )
  })
})
