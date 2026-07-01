// Generador del fichero SEPA de adeudos directos **pain.008.001.02** en TS puro,
// determinista y sin dependencias nativas. Función pura: recibe TODOS los datos
// (incl. identificadores y fechas) por parámetro, así el mismo input produce el
// mismo XML byte a byte (testeable). La no-determinación (now(), id de mensaje)
// se inyecta en el route handler que lo invoca.
//
// Alcance B-5: secuencia RCUR por defecto (adeudo recurrente); esquema CORE.
// FRST/primera-vez está DIFERIDA (follow-up post-B-5: requiere marca por mandato).

/** Secuencia del adeudo (SeqTp). B-5 usa RCUR; el resto queda para follow-up. */
export type SecuenciaAdeudo = 'FRST' | 'RCUR' | 'OOFF' | 'FNAL'

export interface Pain008Deudor {
  /** EndToEndId único de la operación (usamos el id del recibo). */
  endToEndId: string
  /** Identificador del mandato (MndtId). */
  mandateId: string
  /** Fecha de firma del mandato (DtOfSgntr), formato YYYY-MM-DD. */
  mandateDate: string
  /** Nombre del titular del mandato (Dbtr/Nm). */
  debtorName: string
  /** IBAN del deudor (ya descifrado server-side). */
  debtorIban: string
  /** Importe en céntimos (> 0; el caller ya excluyó los ≤ 0). */
  amountCents: number
}

export interface Pain008Input {
  /** MsgId único del fichero (lo genera el caller). */
  messageId: string
  /** Fecha/hora de creación (CreDtTm), ISO 8601 sin milisegundos. */
  creationDateTime: string
  /** Fecha de cobro solicitada (ReqdColltnDt), YYYY-MM-DD. */
  collectionDate: string
  /** Nombre del acreedor (Cdtr/Nm). */
  creditorName: string
  /** Identificador del acreedor / Creditor Identifier (CdtrSchmeId). */
  creditorId: string
  /** IBAN del acreedor (ya descifrado server-side). */
  creditorIban: string
  /** BIC del acreedor o null → NOTPROVIDED. */
  creditorBic: string | null
  /** Secuencia del adeudo (por defecto RCUR). */
  sequenceType?: SecuenciaAdeudo
  deudores: Pain008Deudor[]
}

/** Escapa los 5 caracteres especiales de XML. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Nombre SEPA: recorta a 70 chars y escapa. */
function nombreSepa(value: string): string {
  return esc(value.slice(0, 70))
}

/** Céntimos → importe en euros con exactamente 2 decimales ("120.00"). */
function euros(cents: number): string {
  return (cents / 100).toFixed(2)
}

/**
 * Genera el XML pain.008.001.02 a partir de datos ya validados y descifrados.
 * Asume: `deudores` no vacío, cada `amountCents > 0`, IBANes presentes. La
 * validación (mandatos ausentes, importes ≤ 0, config del acreedor incompleta)
 * la hace el caller ANTES de invocar este generador.
 */
export function generarPain008(input: Pain008Input): string {
  const seq = input.sequenceType ?? 'RCUR'
  const nbTx = input.deudores.length
  const ctrlSumCents = input.deudores.reduce((acc, d) => acc + d.amountCents, 0)
  const ctrlSum = euros(ctrlSumCents)
  const bic = input.creditorBic?.trim() ? esc(input.creditorBic.trim()) : 'NOTPROVIDED'

  const txs = input.deudores
    .map(
      (d) => `      <DrctDbtTxInf>
        <PmtId>
          <EndToEndId>${esc(d.endToEndId)}</EndToEndId>
        </PmtId>
        <InstdAmt Ccy="EUR">${euros(d.amountCents)}</InstdAmt>
        <DrctDbtTx>
          <MndtRltdInf>
            <MndtId>${esc(d.mandateId)}</MndtId>
            <DtOfSgntr>${esc(d.mandateDate)}</DtOfSgntr>
            <AmdmntInd>false</AmdmntInd>
          </MndtRltdInf>
        </DrctDbtTx>
        <DbtrAgt>
          <FinInstnId>
            <Othr>
              <Id>NOTPROVIDED</Id>
            </Othr>
          </FinInstnId>
        </DbtrAgt>
        <Dbtr>
          <Nm>${nombreSepa(d.debtorName)}</Nm>
        </Dbtr>
        <DbtrAcct>
          <Id>
            <IBAN>${esc(d.debtorIban.replace(/\s/g, ''))}</IBAN>
          </Id>
        </DbtrAcct>
        <RmtInf>
          <Ustrd>${esc(d.endToEndId)}</Ustrd>
        </RmtInf>
      </DrctDbtTxInf>`
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrDrctDbtInitn>
    <GrpHdr>
      <MsgId>${esc(input.messageId)}</MsgId>
      <CreDtTm>${esc(input.creationDateTime)}</CreDtTm>
      <NbOfTxs>${nbTx}</NbOfTxs>
      <CtrlSum>${ctrlSum}</CtrlSum>
      <InitgPty>
        <Nm>${nombreSepa(input.creditorName)}</Nm>
      </InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${esc(input.messageId)}</PmtInfId>
      <PmtMtd>DD</PmtMtd>
      <NbOfTxs>${nbTx}</NbOfTxs>
      <CtrlSum>${ctrlSum}</CtrlSum>
      <PmtTpInf>
        <SvcLvl>
          <Cd>SEPA</Cd>
        </SvcLvl>
        <LclInstrm>
          <Cd>CORE</Cd>
        </LclInstrm>
        <SeqTp>${seq}</SeqTp>
      </PmtTpInf>
      <ReqdColltnDt>${esc(input.collectionDate)}</ReqdColltnDt>
      <Cdtr>
        <Nm>${nombreSepa(input.creditorName)}</Nm>
      </Cdtr>
      <CdtrAcct>
        <Id>
          <IBAN>${esc(input.creditorIban.replace(/\s/g, ''))}</IBAN>
        </Id>
      </CdtrAcct>
      <CdtrAgt>
        <FinInstnId>
          <Othr>
            <Id>${bic}</Id>
          </Othr>
        </FinInstnId>
      </CdtrAgt>
      <ChrgBr>SLEV</ChrgBr>
      <CdtrSchmeId>
        <Id>
          <PrvtId>
            <Othr>
              <Id>${esc(input.creditorId)}</Id>
              <SchmeNm>
                <Prtry>SEPA</Prtry>
              </SchmeNm>
            </Othr>
          </PrvtId>
        </Id>
      </CdtrSchmeId>
${txs}
    </PmtInf>
  </CstmrDrctDbtInitn>
</Document>
`
}
