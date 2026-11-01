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
//  - Un identificador de más de 35 caracteres (Max35 del esquema) → no se genera: se listan las
//    familias afectadas. Hoy solo puede pasar con un mandato firmado antes del PR-0b, que medía
//    36; esa familia vuelve a firmar la domiciliación.
//  - Cada adeudo lleva la fecha de cobro de su recibo o, sin ella, la del día de la versión; el
//    generador hace un bloque por fecha.
//  - Los adeudos salen en un orden fijo (familia y recibo): la RPC solo ordena por familia, y una
//    familia con dos recibos en la remesa podía salir en otro orden en la siguiente descarga.

import {
  MAX_IDENTIFICADOR_SEPA,
  generarPain008,
  identificadoresLargos,
  type Pain008Input,
  type SecuenciaAdeudo,
} from './generar-pain008'

/** Fila devuelta por la RPC get_mandatos_remesa (F-4-5: grano familia). */
export interface MandatoRemesaRow {
  recibo_id: string
  familia_id: string
  familia_etiqueta: string
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

/** Lo que el caller saca de la versión del fichero (`versionRemesa`) y del centro. */
export interface RemesaMeta {
  messageId: string
  creationDateTime: string
  /** La fecha de cobro de los recibos sin la suya: el día de la versión, YYYY-MM-DD. */
  fechaPorDefecto: string
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
  | { ok: false; motivo: 'sin_mandato'; familiasSinMandato: string[] }
  | { ok: false; motivo: 'remesa_vacia' }
  | { ok: false; motivo: 'identificador_largo'; familiasIdentificadorLargo: string[] }

/** `EndToEndId` del recibo: su id sin guiones (32 caracteres), el mismo en cada descarga. */
export function endToEndIdDeRecibo(reciboId: string): string {
  return reciboId.replace(/-/g, '').toUpperCase()
}

function tieneMandato(row: MandatoRemesaRow): boolean {
  return (
    row.iban != null &&
    row.iban.trim() !== '' &&
    row.identificador_mandato != null &&
    row.identificador_mandato.trim() !== '' &&
    row.fecha_mandato != null
  )
}

/**
 * `conceptos`: el de cada recibo, por id (`conceptosDeRemesa`). Un recibo cobrable sin concepto es
 * un fallo del caller, y lanza: el fichero no sale con la línea del extracto vacía.
 *
 * `fechasCobro`: la `fecha_cobro_banco` de cada recibo, por id; `null` es «sin fecha» y toma
 * `meta.fechaPorDefecto`. Un recibo cobrable que no está en el mapa es un fallo del caller (no se
 * leyó), y lanza: no se distingue de «sin fecha» y saldría cobrado otro día.
 */
export function prepararRemesa(
  rows: MandatoRemesaRow[],
  acreedor: AcreedorData,
  meta: RemesaMeta,
  conceptos: ReadonlyMap<string, string>,
  fechasCobro: ReadonlyMap<string, string | null>
): PrepararRemesaResultado {
  // 1. Config del acreedor: CID + IBAN son obligatorios (BIC opcional).
  if (!acreedor.identificador_acreedor?.trim() || !acreedor.iban?.trim()) {
    return { ok: false, motivo: 'acreedor_incompleto' }
  }

  // 2. Recibos SEPA sin mandato activo → se rechaza la remesa entera. Se listan las
  //    FAMILIAS afectadas (F-4-5: el deudor es la familia; nino_id ya no aplica).
  const sinMandato = rows.filter((r) => !tieneMandato(r))
  if (sinMandato.length > 0) {
    return {
      ok: false,
      motivo: 'sin_mandato',
      familiasSinMandato: [...new Set(sinMandato.map((r) => r.familia_etiqueta))],
    }
  }

  // 3. Excluir importes ≤ 0 (no se domicilia un abono).
  const excluidosSinImporte = rows.filter((r) => r.total_centimos <= 0).map((r) => r.recibo_id)
  const cobrables = rows
    .filter((r) => r.total_centimos > 0)
    .sort(
      (a, b) => a.familia_id.localeCompare(b.familia_id) || a.recibo_id.localeCompare(b.recibo_id)
    )
  if (cobrables.length === 0) {
    return { ok: false, motivo: 'remesa_vacia' }
  }

  const input: Pain008Input = {
    messageId: meta.messageId,
    creationDateTime: meta.creationDateTime,
    creditorName: meta.creditorName,
    creditorId: acreedor.identificador_acreedor.trim(),
    creditorIban: acreedor.iban.trim(),
    creditorBic: acreedor.bic_acreedor,
    sequenceType: meta.sequenceType ?? 'RCUR',
    deudores: cobrables.map((r) => {
      const concepto = conceptos.get(r.recibo_id)
      if (!concepto) throw new Error('prepararRemesa: recibo sin concepto')
      if (!fechasCobro.has(r.recibo_id)) throw new Error('prepararRemesa: recibo sin leer su fecha')
      return {
        endToEndId: endToEndIdDeRecibo(r.recibo_id),
        mandateId: r.identificador_mandato!.trim(),
        mandateDate: r.fecha_mandato!,
        debtorName: r.titular ?? '',
        debtorIban: r.iban!.trim(),
        amountCents: r.total_centimos,
        concepto,
        collectionDate: fechasCobro.get(r.recibo_id) ?? meta.fechaPorDefecto,
      }
    }),
  }

  // 4. Identificadores que no caben en Max35: se dice qué familias, no se recorta.
  if (identificadoresLargos(input).length > 0) {
    const largas = cobrables.filter(
      (r) => r.identificador_mandato!.trim().length > MAX_IDENTIFICADOR_SEPA
    )
    return {
      ok: false,
      motivo: 'identificador_largo',
      familiasIdentificadorLargo: [...new Set(largas.map((r) => r.familia_etiqueta))],
    }
  }

  return {
    ok: true,
    xml: generarPain008(input),
    numOperaciones: cobrables.length,
    totalCentimos: cobrables.reduce((acc, r) => acc + r.total_centimos, 0),
    excluidosSinImporte,
  }
}
