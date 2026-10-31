import { describe, expect, it } from 'vitest'

import {
  MAX_IDENTIFICADOR_SEPA,
  generarPain008,
  textoSepa,
  type Pain008Input,
} from '../generar-pain008'

// Forma de producción (medida el 2026-10-31): los mandatos firmados antes del PR-0b miden 36
// (`NIDO-{8}-{8}-{13 dígitos}`) y los nuevos, 31 (timestamp en base 36). El EndToEndId es el id
// del recibo sin guiones (32). El fixture de antes (`NIDO-DEMO-TUT1-1`, 16) cabía siempre, y por
// eso no se vio que los de producción no cabían.
const MANDATO_36_PRODUCCION = 'NIDO-33C79B50-87319A17-1784546999227'

const baseInput: Pain008Input = {
  messageId: 'NIDO-ABCDEF12-20260701120000',
  creationDateTime: '2026-07-01T12:00:00',
  collectionDate: '2026-07-05',
  creditorName: 'Escola Infantil Demo',
  creditorId: 'ES00ZZZ00000000000',
  creditorIban: 'ES9121000418450200051332',
  creditorBic: 'CAIXESBBXXX',
  sequenceType: 'RCUR',
  deudores: [
    {
      endToEndId: '0D06FFD1D24E4D6EB1DB341D6C94BB26',
      mandateId: 'NIDO-33C79B50-87319A17-MH3K2Q8L',
      mandateDate: '2026-06-01',
      debtorName: 'Ana Pérez',
      debtorIban: 'ES7620770024003102575766',
      amountCents: 12000,
      concepto: 'CEI Ejemplo · Nino Demo Uno · Octubre 2026',
    },
    {
      endToEndId: '290F1ADF67AB42739AF32B4D9F39B323',
      mandateId: 'NIDO-33C79B50-8F54B0D9-MH3K2Q8M',
      mandateDate: '2026-06-02',
      debtorName: 'Luis Gómez',
      debtorIban: 'ES1000492352082414205416',
      amountCents: 8050,
      concepto: 'CEI Ejemplo · Nino Demo Dos · Octubre 2026',
    },
  ],
}

describe('generarPain008', () => {
  it('genera un XML pain.008.001.02 con cabecera, acreedor y las operaciones', () => {
    const xml = generarPain008(baseInput)
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('urn:iso:std:iso:20022:tech:xsd:pain.008.001.02')
    expect(xml).toContain('<PmtMtd>DD</PmtMtd>')
    expect(xml).toContain('<SeqTp>RCUR</SeqTp>')
    expect(xml).toContain('<Cd>CORE</Cd>')
    expect(xml).toContain('<ReqdColltnDt>2026-07-05</ReqdColltnDt>')
    // Acreedor: IBAN + CID.
    expect(xml).toContain('<IBAN>ES9121000418450200051332</IBAN>')
    expect(xml).toContain('<Id>ES00ZZZ00000000000</Id>')
    // Deudores.
    expect(xml).toContain('<Nm>Ana Pérez</Nm>')
    expect(xml).toContain('<IBAN>ES7620770024003102575766</IBAN>')
    expect(xml).toContain('<MndtId>NIDO-33C79B50-87319A17-MH3K2Q8L</MndtId>')
    expect(xml).toContain('<DtOfSgntr>2026-06-01</DtOfSgntr>')
  })

  it('calcula NbOfTxs y CtrlSum correctamente (importes en euros con 2 decimales)', () => {
    const xml = generarPain008(baseInput)
    expect(xml).toContain('<NbOfTxs>2</NbOfTxs>')
    // 12000 + 8050 = 20050 céntimos = 200.50 €.
    expect(xml).toContain('<CtrlSum>200.50</CtrlSum>')
    expect(xml).toContain('<InstdAmt Ccy="EUR">120.00</InstdAmt>')
    expect(xml).toContain('<InstdAmt Ccy="EUR">80.50</InstdAmt>')
  })

  it('es determinista: el mismo input produce exactamente el mismo XML', () => {
    expect(generarPain008(baseInput)).toBe(generarPain008(baseInput))
  })

  it('usa NOTPROVIDED cuando el BIC del acreedor está vacío', () => {
    const xml = generarPain008({ ...baseInput, creditorBic: null })
    expect(xml).toContain('<Id>NOTPROVIDED</Id>')
  })

  it('escapa los caracteres especiales de XML en los nombres', () => {
    const xml = generarPain008({
      ...baseInput,
      creditorName: 'Escola & Cia <Demo>',
      deudores: [{ ...baseInput.deudores[0], debtorName: 'Marta "La" Ruiz' }],
    })
    expect(xml).toContain('Escola &amp; Cia &lt;Demo&gt;')
    expect(xml).toContain('Marta &quot;La&quot; Ruiz')
    expect(xml).not.toContain('<Demo>')
  })

  it('elimina espacios de los IBAN', () => {
    const xml = generarPain008({
      ...baseInput,
      creditorIban: 'ES91 2100 0418 4502 0005 1332',
    })
    expect(xml).toContain('<IBAN>ES9121000418450200051332</IBAN>')
  })

  it('RCUR es el valor por defecto de secuencia', () => {
    const sinSeq: Pain008Input = { ...baseInput }
    delete sinSeq.sequenceType
    const xml = generarPain008(sinSeq)
    expect(xml).toContain('<SeqTp>RCUR</SeqTp>')
  })

  it('el concepto del extracto es centro, niño y mes en el juego SEPA, no el id del recibo', () => {
    const xml = generarPain008(baseInput)
    expect(xml).toContain('<Ustrd>CEI Ejemplo - Nino Demo Uno - Octubre 2026</Ustrd>')
    expect(xml).not.toContain(`<Ustrd>${baseInput.deudores[0].endToEndId}</Ustrd>`)
    expect(xml).toContain('<EndToEndId>0D06FFD1D24E4D6EB1DB341D6C94BB26</EndToEndId>')
  })

  it('el concepto se corta a 140 caracteres (Max140)', () => {
    const largo = 'A'.repeat(200)
    const xml = generarPain008({
      ...baseInput,
      deudores: [{ ...baseInput.deudores[0], concepto: largo }],
    })
    expect(xml).toContain(`<Ustrd>${'A'.repeat(140)}</Ustrd>`)
  })
})

describe('generarPain008 · identificadores de 35 como máximo (Max35)', () => {
  it('premisa: el mandato de producción mide 36 y el del fixture cabe', () => {
    expect(MANDATO_36_PRODUCCION.length).toBe(36)
    expect(baseInput.deudores[0].mandateId.length).toBeLessThanOrEqual(MAX_IDENTIFICADOR_SEPA)
  })

  it('rechaza un mandato de 36 con un mensaje que dice el límite', () => {
    const input = {
      ...baseInput,
      deudores: [{ ...baseInput.deudores[0], mandateId: MANDATO_36_PRODUCCION }],
    }
    expect(() => generarPain008(input)).toThrow(/más de 35 caracteres/)
  })

  it('la frontera: 35 sale, 36 no; también en EndToEndId y MsgId', () => {
    const d = baseInput.deudores[0]
    expect(() =>
      generarPain008({ ...baseInput, deudores: [{ ...d, mandateId: 'M'.repeat(35) }] })
    ).not.toThrow()
    expect(() =>
      generarPain008({ ...baseInput, deudores: [{ ...d, endToEndId: 'E'.repeat(36) }] })
    ).toThrow(/más de 35/)
    expect(() => generarPain008({ ...baseInput, messageId: 'X'.repeat(36) })).toThrow(/más de 35/)
  })
})

describe('textoSepa', () => {
  it('quita tildes y eñes, el punto medio pasa a guion y lo demás fuera del juego, a espacio', () => {
    expect(textoSepa('Escoleta Peña · Ñoño Güell & Cía · Octubre 2026')).toBe(
      'Escoleta Pena - Nono Guell Cia - Octubre 2026'
    )
  })

  it('deja intactos los caracteres que admite SEPA', () => {
    expect(textoSepa("A-z 0/9 ?:().,'+")).toBe("A-z 0/9 ?:().,'+")
  })
})
