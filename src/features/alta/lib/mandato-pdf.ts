import { jsPDF } from 'jspdf'

import { formatearIban } from './iban'

/**
 * F11-G-2 — generación CLIENTE del PDF del mandato SEPA Core (reusa jsPDF, como el pipeline
 * imagen→PDF de G-1). Compone un documento A4 con el bloque de acreedor (centro), el bloque
 * de deudor (titular + IBAN), la referencia única del mandato, el tipo (recurrente), el texto
 * legal y la firma dibujada (PNG data URL) embebida. Los rótulos llegan ya traducidos desde
 * el componente (`labels`/`textoLegal`) para no acoplar la i18n a esta utilidad.
 *
 * Usa APIs de navegador (jsPDF + el data URL del canvas) → solo se importa desde cliente.
 */

export interface EtiquetasMandatoPdf {
  titulo: string
  acreedorTitulo: string
  deudorTitulo: string
  referencia: string
  tipo: string
  tipoRecurrente: string
  iban: string
  titular: string
  firma: string
  fecha: string
}

export interface DatosMandatoPdf {
  identificadorMandato: string
  iban: string
  titular: string
  acreedorNombre: string
  acreedorDireccion: string
  /**
   * Firma dibujada en PNG data URL (`FirmaPad`). `null` en modo Dirección PRESENCIAL
   * (PR-3b-2 · B2): la familia firmó en papel → el PDF muestra `firmaPresencialNota` en
   * lugar del trazo embebido.
   */
  firmaDataUrl: string | null
  /** Nota que sustituye al trazo cuando `firmaDataUrl` es null (respaldo en papel). */
  firmaPresencialNota?: string
  /** Fecha de firma legible ya formateada por el componente. */
  fechaLegible: string
  textoLegal: string
  labels: EtiquetasMandatoPdf
}

export function generarMandatoPdf(d: DatosMandatoPdf): Blob {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const margen = 48
  const maxW = pageW - margen * 2
  let y = margen

  const linea = (texto: string, size: number, bold: boolean, gap = 16) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    for (const l of doc.splitTextToSize(texto, maxW) as string[]) {
      doc.text(l, margen, y)
      y += gap
    }
  }

  linea(d.labels.titulo, 15, true, 22)
  y += 6

  linea(d.labels.referencia, 9, true, 13)
  linea(d.identificadorMandato, 11, false, 20)

  linea(d.labels.acreedorTitulo, 11, true, 16)
  linea(d.acreedorNombre, 10, false, 14)
  if (d.acreedorDireccion) linea(d.acreedorDireccion, 10, false, 14)
  y += 6

  linea(d.labels.deudorTitulo, 11, true, 16)
  linea(`${d.labels.titular}: ${d.titular}`, 10, false, 14)
  linea(`${d.labels.iban}: ${formatearIban(d.iban)}`, 10, false, 14)
  y += 6

  linea(`${d.labels.tipo}: ${d.labels.tipoRecurrente}`, 10, false, 18)

  linea(d.textoLegal, 9, false, 13)
  y += 10

  linea(`${d.labels.fecha}: ${d.fechaLegible}`, 10, false, 18)

  // Firma bajo su rótulo: trazo dibujado (digital) o nota "firmado en papel" (presencial).
  linea(d.labels.firma, 10, true, 14)
  if (d.firmaDataUrl) {
    try {
      doc.addImage(d.firmaDataUrl, 'PNG', margen, y, 200, 80)
      y += 88
    } catch {
      // Si la firma no es una imagen válida, el resto del documento se mantiene.
    }
  } else if (d.firmaPresencialNota) {
    linea(d.firmaPresencialNota, 10, false, 16)
  }

  return doc.output('blob')
}
