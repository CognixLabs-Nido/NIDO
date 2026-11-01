import { describe, expect, it } from 'vitest'

import {
  MAX_IDENTIFICADOR_SEPA,
  generarPain008,
  textoSepa,
  type Pain008Deudor,
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
      collectionDate: '2026-07-05',
    },
    {
      endToEndId: '290F1ADF67AB42739AF32B4D9F39B323',
      mandateId: 'NIDO-33C79B50-8F54B0D9-MH3K2Q8M',
      mandateDate: '2026-06-02',
      debtorName: 'Luis Gómez',
      debtorIban: 'ES1000492352082414205416',
      amountCents: 8050,
      concepto: 'CEI Ejemplo · Nino Demo Dos · Octubre 2026',
      collectionDate: '2026-07-05',
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

/** Los bloques del XML, leídos del texto (no de `bloquesPain008`: lo que mira el banco). */
function bloquesDelXml(xml: string) {
  return [...xml.matchAll(/<PmtInf>([\s\S]*?)<\/PmtInf>/g)].map(([, b]) => ({
    id: b.match(/<PmtInfId>(.*?)<\/PmtInfId>/)![1],
    fecha: b.match(/<ReqdColltnDt>(.*?)<\/ReqdColltnDt>/)![1],
    nbTx: Number(b.match(/<NbOfTxs>(\d+)<\/NbOfTxs>/)![1]),
    ctrlSum: Math.round(Number(b.match(/<CtrlSum>([\d.]+)<\/CtrlSum>/)![1]) * 100),
    importes: [...b.matchAll(/<InstdAmt Ccy="EUR">([\d.]+)<\/InstdAmt>/g)].map(([, v]) =>
      Math.round(Number(v) * 100)
    ),
    e2e: [...b.matchAll(/<EndToEndId>(.*?)<\/EndToEndId>/g)].map(([, v]) => v),
  }))
}

function cabeceraDelXml(xml: string) {
  const g = xml.match(/<GrpHdr>([\s\S]*?)<\/GrpHdr>/)![1]
  return {
    nbTx: Number(g.match(/<NbOfTxs>(\d+)<\/NbOfTxs>/)![1]),
    ctrlSum: Math.round(Number(g.match(/<CtrlSum>([\d.]+)<\/CtrlSum>/)![1]) * 100),
  }
}

function deudor(n: number, importe: number, fecha: string): Pain008Deudor {
  return {
    ...baseInput.deudores[0],
    endToEndId: `E2E${String(n).padStart(29, '0')}`,
    amountCents: importe,
    collectionDate: fecha,
  }
}

describe('generarPain008 · un bloque por fecha de cobro', () => {
  // Cinco adeudos en tres fechas, desordenados: importes que no se compensan entre sí.
  const variasFechas: Pain008Input = {
    ...baseInput,
    deudores: [
      deudor(1, 12000, '2026-07-10'),
      deudor(2, 8050, '2026-07-05'),
      deudor(3, 33333, '2026-07-10'),
      deudor(4, 101, '2026-07-20'),
      deudor(5, 7, '2026-07-05'),
    ],
  }

  it('con una sola fecha, un bloque con el MsgId de PmtInfId, como antes', () => {
    const bloques = bloquesDelXml(generarPain008(baseInput))
    expect(bloques).toHaveLength(1)
    expect(bloques[0].id).toBe(baseInput.messageId)
    expect(bloques[0].fecha).toBe('2026-07-05')
  })

  it('tres fechas, tres bloques ordenados por fecha, con PmtInfId {MsgId}-{n}', () => {
    const bloques = bloquesDelXml(generarPain008(variasFechas))
    expect(bloques.map((b) => [b.id, b.fecha])).toEqual([
      [`${baseInput.messageId}-1`, '2026-07-05'],
      [`${baseInput.messageId}-2`, '2026-07-10'],
      [`${baseInput.messageId}-3`, '2026-07-20'],
    ])
    // Cada adeudo en el bloque de su fecha, en el orden en que llegó.
    expect(bloques.map((b) => b.e2e)).toEqual([
      [deudor(2, 0, '').endToEndId, deudor(5, 0, '').endToEndId],
      [deudor(1, 0, '').endToEndId, deudor(3, 0, '').endToEndId],
      [deudor(4, 0, '').endToEndId],
    ])
    // Un solo MsgId en el fichero.
    expect(generarPain008(variasFechas).match(/<MsgId>/g)).toHaveLength(1)
  })

  it('los totales de los bloques suman el total del fichero, y cada bloque, sus adeudos', () => {
    for (const input of [baseInput, variasFechas]) {
      const xml = generarPain008(input)
      const cabecera = cabeceraDelXml(xml)
      const bloques = bloquesDelXml(xml)
      // Premisa: la cabecera cuenta lo que entró.
      expect(cabecera.nbTx).toBe(input.deudores.length)
      expect(cabecera.ctrlSum).toBe(input.deudores.reduce((a, d) => a + d.amountCents, 0))
      expect(bloques.reduce((a, b) => a + b.nbTx, 0)).toBe(cabecera.nbTx)
      expect(bloques.reduce((a, b) => a + b.ctrlSum, 0)).toBe(cabecera.ctrlSum)
      for (const b of bloques) {
        expect(b.importes).toHaveLength(b.nbTx)
        expect(b.importes.reduce((a, v) => a + v, 0)).toBe(b.ctrlSum)
      }
    }
    // Lo medido, en números: 80.57, 453.33 y 1.01 suman 534.91.
    const bloques = bloquesDelXml(generarPain008(variasFechas))
    expect(bloques.map((b) => b.ctrlSum)).toEqual([8057, 45333, 101])
    expect(cabeceraDelXml(generarPain008(variasFechas)).ctrlSum).toBe(53491)
  })

  it('el PmtInfId con número cabe en Max35: con un MsgId de 34 el bloque mide 36 y no sale', () => {
    const conDos = (messageId: string): Pain008Input => ({
      ...variasFechas,
      messageId,
      deudores: variasFechas.deudores.slice(0, 2),
    })
    // 33 + «-1» = 35: sale. 34 + «-1» = 36: no, aunque el MsgId solo quepa.
    expect(() => generarPain008(conDos('M'.repeat(33)))).not.toThrow()
    expect(() => generarPain008(conDos('M'.repeat(34)))).toThrow(/más de 35/)
    // Con una sola fecha, PmtInfId = MsgId: 35 cabe.
    expect(() => generarPain008({ ...baseInput, messageId: 'M'.repeat(35) })).not.toThrow()
  })

  it('el MsgId de la casa (28) deja sitio a 999 bloques', () => {
    expect(`${baseInput.messageId}-999`.length).toBeLessThanOrEqual(MAX_IDENTIFICADOR_SEPA)
  })

  it('un adeudo sin una fecha YYYY-MM-DD real no sale', () => {
    for (const mala of ['', '2026-7-5', '2026-02-30', '05/07/2026']) {
      const input = { ...baseInput, deudores: [deudor(1, 100, mala)] }
      expect(() => generarPain008(input), mala).toThrow(/sin fecha de cobro/)
    }
  })
})
