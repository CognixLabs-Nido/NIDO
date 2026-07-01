import { describe, expect, it } from 'vitest'

import { generarPain008, type Pain008Input } from '../generar-pain008'

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
      endToEndId: '11111111-1111-4111-8111-111111111111',
      mandateId: 'NIDO-DEMO-TUT1-1',
      mandateDate: '2026-06-01',
      debtorName: 'Ana Pérez',
      debtorIban: 'ES7620770024003102575766',
      amountCents: 12000,
    },
    {
      endToEndId: '22222222-2222-4222-9222-222222222222',
      mandateId: 'NIDO-DEMO-TUT2-1',
      mandateDate: '2026-06-02',
      debtorName: 'Luis Gómez',
      debtorIban: 'ES1000492352082414205416',
      amountCents: 8050,
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
    expect(xml).toContain('<MndtId>NIDO-DEMO-TUT1-1</MndtId>')
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
})
