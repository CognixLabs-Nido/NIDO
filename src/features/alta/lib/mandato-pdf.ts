import { createHash } from 'node:crypto'

import { jsPDF } from 'jspdf'

import { formatearIban } from './iban'
import {
  fechaDelMandato,
  PLANTILLAS_PDF_MANDATO,
  type IdiomaMandato,
} from './mandato-pdf-plantillas'

/**
 * El PDF del mandato SEPA, compuesto por el SERVIDOR (2026-11-22, decisión 2 del cierre,
 * `docs/specs/mandato-sepa-cierre.md`: «Que lo fabrique el móvil y nadie mire lo que pone es lo que
 * permite que el fichero diga algo distinto de lo registrado»). Hasta entonces lo componía el
 * navegador y el servidor solo miraba que fuera un PDF.
 *
 * DETERMINISTA: con los mismos datos sellados, la misma versión de plantilla y el mismo idioma sale
 * el mismo fichero, byte a byte. La fecha de creación del PDF es la de la firma y su identificador
 * interno sale del identificador del mandato; los textos son los congelados de la plantilla. Así el
 * PDF se puede rehacer desde la fila y comparar su sha256 con el sellado (`documento_sha256`).
 *
 * Sin el bloque «firmado en papel»: el presencial no tiene PDF, su prueba es el papel.
 */
/**
 * El trazo no se puede pintar en el PDF: la ruta solo comprueba que empiece por `data:image/png`, y
 * un PNG con esa cabecera y sin imagen dentro llega hasta aquí (medido el 2026-11-23: jspdf lanza
 * `RangeError`). Lo traduce `firmarMandatoDigital` al mensaje de firma; ningún otro error, sí.
 */
export class FirmaNoDecodifica extends Error {
  constructor(causa: unknown) {
    super('la firma no es una imagen PNG que se pueda pintar', { cause: causa })
    this.name = 'FirmaNoDecodifica'
  }
}

export interface DatosMandatoPdf {
  identificadorMandato: string
  iban: string
  titular: string
  titularDocumento: string
  titularDireccion: string
  acreedorNombre: string
  acreedorDireccion: string
  acreedorCid: string
  /** El trazo, PNG en data URL. */
  firmaDataUrl: string
  fechaFirmaIso: string
  idioma: IdiomaMandato
  plantillaVersion: number
}

export function generarMandatoPdf(d: DatosMandatoPdf): Uint8Array {
  const textos = PLANTILLAS_PDF_MANDATO[d.plantillaVersion]?.[d.idioma]
  if (!textos)
    throw new Error(`plantilla del mandato desconocida: ${d.plantillaVersion}/${d.idioma}`)

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  doc.setCreationDate(new Date(d.fechaFirmaIso))
  doc.setFileId(
    createHash('sha256').update(d.identificadorMandato).digest('hex').slice(0, 32).toUpperCase()
  )
  const margen = 48
  const maxW = doc.internal.pageSize.getWidth() - margen * 2
  let y = margen

  const linea = (texto: string, size: number, bold: boolean, gap = 16) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    for (const l of doc.splitTextToSize(texto, maxW) as string[]) {
      doc.text(l, margen, y)
      y += gap
    }
  }

  linea(textos.titulo, 15, true, 22)
  y += 6
  linea(textos.referencia, 9, true, 13)
  linea(d.identificadorMandato, 11, false, 20)

  linea(textos.acreedorTitulo, 11, true, 16)
  linea(d.acreedorNombre, 10, false, 14)
  if (d.acreedorDireccion) linea(d.acreedorDireccion, 10, false, 14)
  linea(`${textos.acreedorCid}: ${d.acreedorCid}`, 10, false, 14)
  y += 6

  linea(textos.deudorTitulo, 11, true, 16)
  linea(`${textos.titular}: ${d.titular}`, 10, false, 14)
  linea(`${textos.titularDocumento}: ${d.titularDocumento}`, 10, false, 14)
  linea(`${textos.titularDireccion}: ${d.titularDireccion}`, 10, false, 14)
  linea(`${textos.iban}: ${formatearIban(d.iban)}`, 10, false, 14)
  y += 6

  linea(`${textos.tipo}: ${textos.tipoRecurrente}`, 10, false, 18)
  linea(textos.textoLegal, 9, false, 13)
  y += 10

  linea(`${textos.fecha}: ${fechaDelMandato(textos, d.fechaFirmaIso)}`, 10, false, 18)
  linea(textos.firma, 10, true, 14)
  // Un trazo que no es una imagen válida no se sella: el servidor no compone un mandato sin firma.
  // Solo esta línea se envuelve: lo que falle al componer el resto NO es un problema de la firma, y
  // decirle a la familia «dibuja tu firma» por otra cosa la mandaría a buscar donde no está.
  try {
    doc.addImage(d.firmaDataUrl, 'PNG', margen, y, 200, 80)
  } catch (e) {
    throw new FirmaNoDecodifica(e)
  }

  return new Uint8Array(doc.output('arraybuffer'))
}
