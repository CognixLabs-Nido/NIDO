/**
 * Las plantillas del PDF del mandato SEPA, CONGELADAS por versión (2026-11-22, decisión 2 del cierre:
 * `docs/specs/mandato-sepa-cierre.md`). El PDF lo compone el servidor y sus bytes entran en el sello
 * (v3), así que con los datos sellados y la versión de su plantilla tiene que salir el mismo fichero,
 * byte a byte, hoy y dentro de seis años. Por eso los textos no salen de `messages/*.json` (que
 * cambian) sino de aquí, y la fecha no la formatea `Intl` (que cambia con la versión de ICU).
 *
 * Una plantilla publicada NO se edita: un cambio de texto es una versión nueva, y la de cada mandato
 * va en `mandatos_sepa.plantilla_pdf_version`.
 */

export type IdiomaMandato = 'es' | 'en' | 'va'
export const IDIOMAS_MANDATO: readonly IdiomaMandato[] = ['es', 'en', 'va']

export interface TextosPlantillaMandato {
  titulo: string
  referencia: string
  acreedorTitulo: string
  acreedorCid: string
  deudorTitulo: string
  titular: string
  titularDocumento: string
  titularDireccion: string
  iban: string
  tipo: string
  tipoRecurrente: string
  textoLegal: string
  fecha: string
  firma: string
  /** Los doce meses, para escribir la fecha sin `Intl`. */
  meses: readonly string[]
  /** La fecha larga: `{d}`, `{mes}` y `{a}`. */
  formatoFecha: string
}

export const PLANTILLA_PDF_MANDATO_VIGENTE = 1

export const PLANTILLAS_PDF_MANDATO: Readonly<
  Record<number, Readonly<Record<IdiomaMandato, TextosPlantillaMandato>>>
> = {
  1: {
    es: {
      titulo: 'Orden de domiciliación de adeudo directo SEPA',
      referencia: 'Referencia del mandato',
      acreedorTitulo: 'Acreedor',
      acreedorCid: 'Identificador de acreedor',
      deudorTitulo: 'Deudor',
      titular: 'Titular de la cuenta',
      titularDocumento: 'NIF o documento de identidad',
      titularDireccion: 'Dirección del titular',
      iban: 'IBAN',
      tipo: 'Tipo de pago',
      tipoRecurrente: 'Recurrente',
      textoLegal:
        'Mediante la firma de este mandato, autorizo al acreedor a enviar instrucciones a mi entidad para adeudar en mi cuenta, y a mi entidad a efectuar los adeudos conforme a dichas instrucciones. Dispongo del derecho a la devolución por mi entidad en los términos y condiciones del contrato suscrito con ella, dentro de las ocho semanas siguientes a la fecha de adeudo.',
      fecha: 'Fecha',
      firma: 'Firma',
      meses: [
        'enero',
        'febrero',
        'marzo',
        'abril',
        'mayo',
        'junio',
        'julio',
        'agosto',
        'septiembre',
        'octubre',
        'noviembre',
        'diciembre',
      ],
      formatoFecha: '{d} de {mes} de {a}',
    },
    en: {
      titulo: 'SEPA direct debit mandate order',
      referencia: 'Mandate reference',
      acreedorTitulo: 'Creditor',
      acreedorCid: 'Creditor identifier',
      deudorTitulo: 'Debtor',
      titular: 'Account holder',
      titularDocumento: 'NIF or identity document',
      titularDireccion: "Account holder's address",
      iban: 'IBAN',
      tipo: 'Payment type',
      tipoRecurrente: 'Recurrent',
      textoLegal:
        'By signing this mandate, you authorise the creditor to send instructions to your bank to debit your account, and your bank to debit your account in accordance with those instructions. You are entitled to a refund from your bank under the terms and conditions of your agreement with it, within eight weeks of the debit date.',
      fecha: 'Date',
      firma: 'Signature',
      meses: [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ],
      formatoFecha: '{d} {mes} {a}',
    },
    va: {
      titulo: "Orde de domiciliació d'adeudament directe SEPA",
      referencia: 'Referència del mandat',
      acreedorTitulo: 'Creditor',
      acreedorCid: 'Identificador de creditor',
      deudorTitulo: 'Deutor',
      titular: 'Titular del compte',
      titularDocumento: "NIF o document d'identitat",
      titularDireccion: 'Adreça del titular',
      iban: 'IBAN',
      tipo: 'Tipus de pagament',
      tipoRecurrente: 'Recurrent',
      textoLegal:
        "Mitjançant la firma d'este mandat, autoritze el creditor a enviar instruccions a la meua entitat per a adeudar en el meu compte, i a la meua entitat a efectuar els adeudaments conforme a les dites instruccions. Dispose del dret a la devolució per la meua entitat en els termes i condicions del contracte subscrit amb ella, dins de les huit setmanes següents a la data d'adeudament.",
      fecha: 'Data',
      firma: 'Firma',
      meses: [
        'gener',
        'febrer',
        'març',
        'abril',
        'maig',
        'juny',
        'juliol',
        'agost',
        'setembre',
        'octubre',
        'novembre',
        'desembre',
      ],
      formatoFecha: '{d} de {mes} de {a}',
    },
  },
}

/** La fecha de firma en Madrid, escrita con los meses de la plantilla (sin `Intl`). */
export function fechaDelMandato(textos: TextosPlantillaMandato, fechaFirmaIso: string): string {
  // Madrid es UTC+1 o UTC+2; el día se calcula con la regla de la UE (último domingo de marzo y de
  // octubre, a la 01:00 UTC), sin depender de la base de husos del sistema.
  const t = new Date(fechaFirmaIso)
  const anio = t.getUTCFullYear()
  const ultimoDomingo = (mes: number) => {
    const d = new Date(Date.UTC(anio, mes + 1, 0, 1))
    d.setUTCDate(d.getUTCDate() - d.getUTCDay())
    return d.getTime()
  }
  const verano = t.getTime() >= ultimoDomingo(2) && t.getTime() < ultimoDomingo(9)
  const local = new Date(t.getTime() + (verano ? 2 : 1) * 3600_000)
  return textos.formatoFecha
    .replace('{d}', String(local.getUTCDate()))
    .replace('{mes}', textos.meses[local.getUTCMonth()])
    .replace('{a}', String(local.getUTCFullYear()))
}
