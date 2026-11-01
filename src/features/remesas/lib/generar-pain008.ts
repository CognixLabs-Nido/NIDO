// Generador del fichero SEPA de adeudos directos **pain.008.001.02** en TS puro,
// determinista y sin dependencias nativas. Función pura: recibe TODOS los datos
// (incl. identificadores y fechas) por parámetro, así el mismo input produce el
// mismo XML byte a byte (testeable). Lo que depende de la versión (MsgId, CreDtTm y
// la fecha por defecto) lo calcula el route handler a partir de la marca del fichero.
//
// Alcance B-5: secuencia RCUR por defecto (adeudo recurrente); esquema CORE.
// Siempre RCUR: FRST NO se construye (cancelado el 2026-11-01). El Rulebook procesa un FRST como un
// RCUR (SDD Core 2025, AT-M006), así que no cambia nada en el banco ni protege del doble cobro.
//
// Un bloque de pago (`PmtInf`) por fecha de cobro distinta: en pain.008 `ReqdColltnDt` va por
// bloque, no por adeudo (spec `docs/specs/altas-serie.md`, «La fecha de cobro»).

/** Secuencia del adeudo (SeqTp). La app emite siempre RCUR (cabecera); el tipo admite el resto. */
export type SecuenciaAdeudo = 'FRST' | 'RCUR' | 'OOFF' | 'FNAL'

/**
 * Tope de `MsgId`, `PmtInfId`, `EndToEndId` y `MndtId` en pain.008.001.02 (Max35Text). Un
 * identificador más largo no se recorta: recortado ya no es el que firmó la familia, y el banco
 * que valida el esquema rechaza el fichero entero.
 */
export const MAX_IDENTIFICADOR_SEPA = 35

/** Tope del concepto (`RmtInf/Ustrd`, Max140Text). */
export const MAX_CONCEPTO_SEPA = 140

export interface Pain008Deudor {
  /** EndToEndId único de la operación (el id del recibo sin guiones). */
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
  /** Lo que la familia lee en el extracto (`Ustrd`): centro, niño y mes. */
  concepto: string
  /**
   * Fecha de cobro que se pide al banco (`ReqdColltnDt`), YYYY-MM-DD: la del recibo o, si no
   * tiene, la del día de la versión (`prepararRemesa`). En el fichero va en su bloque.
   */
  collectionDate: string
}

export interface Pain008Input {
  /** MsgId único del fichero (lo genera el caller). */
  messageId: string
  /** Fecha/hora de creación (CreDtTm), ISO 8601 sin milisegundos. */
  creationDateTime: string
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

/** Un bloque de pago (`PmtInf`): los adeudos de una misma fecha de cobro. */
export interface BloquePain008 {
  /** `PmtInfId`: el `MsgId` si el fichero tiene un solo bloque; si no, `{MsgId}-{n}`. */
  paymentInfoId: string
  collectionDate: string
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

/**
 * Texto en el juego de caracteres latino básico de SEPA (letras sin tildes, cifras, espacio y
 * `/ - ? : ( ) . , ' +`), que es lo único que todo banco acepta. El punto medio del formato del
 * concepto pasa a guion; cualquier otro carácter, a espacio. El concepto se compone con `·` (es el
 * formato que decidió el responsable, y el de una pantalla si se enseña) y solo el fichero lo
 * escribe con guion: no igualarlos (`concepto-adeudo.ts`).
 */
export function textoSepa(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/·/g, '-')
    .replace(/[^A-Za-z0-9/?:().,'+\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Un bloque por fecha de cobro distinta, de la más temprana a la más tardía. Dentro de cada uno,
 * los adeudos en el orden en que llegan (lo fija el caller: `prepararRemesa`). Con una sola fecha,
 * un bloque con el `MsgId` de `PmtInfId`, como antes de que el recibo tuviera fecha.
 */
export function bloquesPain008(input: Pain008Input): BloquePain008[] {
  const porFecha = new Map<string, Pain008Deudor[]>()
  for (const d of input.deudores) {
    const lista = porFecha.get(d.collectionDate)
    if (lista) lista.push(d)
    else porFecha.set(d.collectionDate, [d])
  }
  const fechas = [...porFecha.keys()].sort()
  return fechas.map((fecha, i) => ({
    paymentInfoId: fechas.length === 1 ? input.messageId : `${input.messageId}-${i + 1}`,
    collectionDate: fecha,
    deudores: porFecha.get(fecha)!,
  }))
}

/** Identificadores del fichero que no caben en Max35 (vacío si todos caben). */
export function identificadoresLargos(input: Pain008Input): string[] {
  return [
    input.messageId,
    ...bloquesPain008(input).map((b) => b.paymentInfoId),
    ...input.deudores.flatMap((d) => [d.endToEndId, d.mandateId]),
  ].filter((id) => id.length > MAX_IDENTIFICADOR_SEPA)
}

/** Una fecha `YYYY-MM-DD` que existe en el calendario. */
function esFechaIso(fecha: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false
  const d = new Date(`${fecha}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha
}

/** Nombre SEPA: recorta a 70 chars y escapa. */
function nombreSepa(value: string): string {
  return esc(value.slice(0, 70))
}

/** Céntimos → importe en euros con exactamente 2 decimales ("120.00"). */
function euros(cents: number): string {
  return (cents / 100).toFixed(2)
}

function sumaCentimos(deudores: Pain008Deudor[]): number {
  return deudores.reduce((acc, d) => acc + d.amountCents, 0)
}

/**
 * Genera el XML pain.008.001.02 a partir de datos ya validados y descifrados.
 * Asume: `deudores` no vacío, cada `amountCents > 0`, IBANes presentes. La
 * validación (mandatos ausentes, importes ≤ 0, config del acreedor incompleta)
 * la hace el caller ANTES de invocar este generador.
 */
export function generarPain008(input: Pain008Input): string {
  // Red del generador: el caller ya lo rechaza con su motivo (`prepararRemesa`); aquí no sale un
  // fichero que el banco vaya a devolver.
  const largos = identificadoresLargos(input)
  if (largos.length > 0) {
    throw new Error(
      `pain.008: ${largos.length} identificador(es) de más de ${MAX_IDENTIFICADOR_SEPA} caracteres`
    )
  }
  const sinFecha = input.deudores.filter((d) => !esFechaIso(d.collectionDate))
  if (sinFecha.length > 0) {
    throw new Error(`pain.008: ${sinFecha.length} adeudo(s) sin fecha de cobro YYYY-MM-DD`)
  }
  const seq = input.sequenceType ?? 'RCUR'
  const bic = input.creditorBic?.trim() ? esc(input.creditorBic.trim()) : 'NOTPROVIDED'
  const bloques = bloquesPain008(input)

  // La cabecera cuenta los adeudos que ENTRARON; cada bloque, los suyos. Si el reparto perdiera o
  // repitiera alguno, el banco rechazaría el fichero por los totales: aquí no sale.
  const nbTx = input.deudores.length
  const ctrlSumCents = sumaCentimos(input.deudores)
  const enBloques = bloques.flatMap((b) => b.deudores)
  if (enBloques.length !== nbTx || sumaCentimos(enBloques) !== ctrlSumCents) {
    throw new Error('pain.008: los bloques no suman el total del fichero')
  }

  const acreedor: DatosAcreedorXml = {
    seq,
    bic,
    creditorName: input.creditorName,
    creditorIban: input.creditorIban,
    creditorId: input.creditorId,
  }
  const pmtInfs = bloques.map((b) => bloqueXml(b, acreedor)).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrDrctDbtInitn>
    <GrpHdr>
      <MsgId>${esc(input.messageId)}</MsgId>
      <CreDtTm>${esc(input.creationDateTime)}</CreDtTm>
      <NbOfTxs>${nbTx}</NbOfTxs>
      <CtrlSum>${euros(ctrlSumCents)}</CtrlSum>
      <InitgPty>
        <Nm>${nombreSepa(input.creditorName)}</Nm>
      </InitgPty>
    </GrpHdr>
${pmtInfs}
  </CstmrDrctDbtInitn>
</Document>
`
}

interface DatosAcreedorXml {
  seq: SecuenciaAdeudo
  bic: string
  creditorName: string
  creditorIban: string
  creditorId: string
}

/** Un `PmtInf`: su fecha, sus totales y sus adeudos. */
function bloqueXml(b: BloquePain008, c: DatosAcreedorXml): string {
  const txs = b.deudores
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
          <Ustrd>${esc(textoSepa(d.concepto).slice(0, MAX_CONCEPTO_SEPA))}</Ustrd>
        </RmtInf>
      </DrctDbtTxInf>`
    )
    .join('\n')

  return `    <PmtInf>
      <PmtInfId>${esc(b.paymentInfoId)}</PmtInfId>
      <PmtMtd>DD</PmtMtd>
      <NbOfTxs>${b.deudores.length}</NbOfTxs>
      <CtrlSum>${euros(sumaCentimos(b.deudores))}</CtrlSum>
      <PmtTpInf>
        <SvcLvl>
          <Cd>SEPA</Cd>
        </SvcLvl>
        <LclInstrm>
          <Cd>CORE</Cd>
        </LclInstrm>
        <SeqTp>${c.seq}</SeqTp>
      </PmtTpInf>
      <ReqdColltnDt>${esc(b.collectionDate)}</ReqdColltnDt>
      <Cdtr>
        <Nm>${nombreSepa(c.creditorName)}</Nm>
      </Cdtr>
      <CdtrAcct>
        <Id>
          <IBAN>${esc(c.creditorIban.replace(/\s/g, ''))}</IBAN>
        </Id>
      </CdtrAcct>
      <CdtrAgt>
        <FinInstnId>
          <Othr>
            <Id>${c.bic}</Id>
          </Othr>
        </FinInstnId>
      </CdtrAgt>
      <ChrgBr>SLEV</ChrgBr>
      <CdtrSchmeId>
        <Id>
          <PrvtId>
            <Othr>
              <Id>${esc(c.creditorId)}</Id>
              <SchmeNm>
                <Prtry>SEPA</Prtry>
              </SchmeNm>
            </Othr>
          </PrvtId>
        </Id>
      </CdtrSchmeId>
${txs}
    </PmtInf>`
}
