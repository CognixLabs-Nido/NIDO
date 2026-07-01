// Ensambla y VALIDA los datos de una remesa antes de generar el XML. Función pura
// (la parte no-determinista —id de mensaje, fechas— llega por parámetro desde el
// route handler). Reglas de negocio B-5:
//  - Config del acreedor incompleta (sin CID o sin IBAN) → no se puede generar.
//  - Recibo SEPA de la remesa SIN mandato activo → NO se genera a medias: se
//    rechaza y se listan los niños afectados (la RPC los devuelve con campos de
//    mandato en NULL; nunca se caen en silencio).
//  - Recibo con total ≤ 0 (saldo a favor) → excluido del adeudo (no se domicilia
//    un abono), pero no bloquea la remesa; se informa como excluido.
//  - Si tras excluir no queda ningún deudor → remesa vacía.

import { generarPain008, type Pain008Input, type SecuenciaAdeudo } from './generar-pain008'

/** Fila devuelta por la RPC get_mandatos_remesa. */
export interface MandatoRemesaRow {
  recibo_id: string
  nino_id: string
  total_centimos: number
  identificador_mandato: string | null
  iban: string | null
  titular: string | null
  fecha_mandato: string | null
}

/** Datos del acreedor devueltos por la RPC get_datos_acreedor (IBAN descifrado). */
export interface AcreedorData {
  identificador_acreedor: string | null
  bic_acreedor: string | null
  iban: string | null
}

/** Metadatos no-deterministas inyectados por el caller. */
export interface RemesaMeta {
  messageId: string
  creationDateTime: string
  collectionDate: string
  creditorName: string
  sequenceType?: SecuenciaAdeudo
}

export type PrepararRemesaResultado =
  | {
      ok: true
      xml: string
      numOperaciones: number
      totalCentimos: number
      excluidosSinImporte: string[]
    }
  | { ok: false; motivo: 'acreedor_incompleto' }
  | { ok: false; motivo: 'sin_mandato'; ninosSinMandato: string[] }
  | { ok: false; motivo: 'remesa_vacia' }

function tieneMandato(row: MandatoRemesaRow): boolean {
  return (
    row.iban != null &&
    row.iban.trim() !== '' &&
    row.identificador_mandato != null &&
    row.identificador_mandato.trim() !== '' &&
    row.fecha_mandato != null
  )
}

export function prepararRemesa(
  rows: MandatoRemesaRow[],
  acreedor: AcreedorData,
  meta: RemesaMeta
): PrepararRemesaResultado {
  // 1. Config del acreedor: CID + IBAN son obligatorios (BIC opcional).
  if (!acreedor.identificador_acreedor?.trim() || !acreedor.iban?.trim()) {
    return { ok: false, motivo: 'acreedor_incompleto' }
  }

  // 2. Recibos SEPA sin mandato activo → se rechaza la remesa entera.
  const sinMandato = rows.filter((r) => !tieneMandato(r))
  if (sinMandato.length > 0) {
    return { ok: false, motivo: 'sin_mandato', ninosSinMandato: sinMandato.map((r) => r.nino_id) }
  }

  // 3. Excluir importes ≤ 0 (no se domicilia un abono).
  const excluidosSinImporte = rows.filter((r) => r.total_centimos <= 0).map((r) => r.recibo_id)
  const cobrables = rows.filter((r) => r.total_centimos > 0)
  if (cobrables.length === 0) {
    return { ok: false, motivo: 'remesa_vacia' }
  }

  const input: Pain008Input = {
    messageId: meta.messageId,
    creationDateTime: meta.creationDateTime,
    collectionDate: meta.collectionDate,
    creditorName: meta.creditorName,
    creditorId: acreedor.identificador_acreedor.trim(),
    creditorIban: acreedor.iban.trim(),
    creditorBic: acreedor.bic_acreedor,
    sequenceType: meta.sequenceType ?? 'RCUR',
    deudores: cobrables.map((r) => ({
      endToEndId: r.recibo_id,
      mandateId: r.identificador_mandato!.trim(),
      mandateDate: r.fecha_mandato!,
      debtorName: r.titular ?? '',
      debtorIban: r.iban!.trim(),
      amountCents: r.total_centimos,
    })),
  }

  return {
    ok: true,
    xml: generarPain008(input),
    numOperaciones: cobrables.length,
    totalCentimos: cobrables.reduce((acc, r) => acc + r.total_centimos, 0),
    excluidosSinImporte,
  }
}
