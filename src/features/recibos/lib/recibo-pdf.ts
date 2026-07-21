import { formatEuros } from '@/shared/lib/format-money'
import { CONTENT_W, MARGIN, MUTED, nuevoDocumento, type RowCell } from '@/shared/lib/pdf/document'
import { embedLogoNido } from '@/shared/lib/pdf/logo-nido'

/**
 * Generador del PDF de un RECIBO para el portal de la familia (B4). Reusa el `Writer`
 * compartido (mismo patrón que el PDF de informes) y embebe el logo de NIDO arriba. El
 * nombre del niño se muestra UNA vez como cabecera de su sección; las líneas van solo con
 * concepto + cantidad + precio unitario + importe (el llamante ya limpió el nombre embebido
 * de `lineas_recibo.descripcion`). Módulo puro: la ruta le pasa datos ya autorizados.
 */

export interface LineaReciboPdf {
  /** Concepto limpio (sin el nombre del niño embebido). */
  etiqueta: string
  cantidad: number
  precioUnitarioCentimos: number
  importeCentimos: number
}

export interface GrupoHijoPdf {
  ninoNombre: string
  lineas: LineaReciboPdf[]
  subtotalCentimos: number
}

export interface ReciboPdfLabels {
  documento: string
  concepto: string
  cantidad: string
  precioUnitario: string
  importe: string
  subtotal: string
  total: string
  lineasFamiliares: string
}

export interface ReciboPdfData {
  centroNombre: string
  /** Período ("Enero 2026") o concepto esporádico. */
  titulo: string
  estadoLabel: string
  metodoLabel: string | null
  fechaLinea: string | null
  labels: ReciboPdfLabels
  gruposHijo: GrupoHijoPdf[]
  lineasFamiliares: LineaReciboPdf[]
  subtotalFamiliarCentimos: number
  totalCentimos: number
}

// Columnas de la tabla de líneas (x absolutos + anchos que suman CONTENT_W).
const COL = {
  conceptoX: MARGIN,
  conceptoW: 235,
  cantidadX: MARGIN + 235,
  cantidadW: 70,
  precioX: MARGIN + 305,
  precioW: 85,
  importeX: MARGIN + 390,
  importeW: CONTENT_W - 390, // 93
}

type W = Awaited<ReturnType<typeof nuevoDocumento>>['writer']

function filaLinea(l: LineaReciboPdf): RowCell[] {
  return [
    { text: l.etiqueta, x: COL.conceptoX, width: COL.conceptoW },
    { text: String(l.cantidad), x: COL.cantidadX, width: COL.cantidadW, align: 'right' },
    {
      text: formatEuros(l.precioUnitarioCentimos),
      x: COL.precioX,
      width: COL.precioW,
      align: 'right',
    },
    { text: formatEuros(l.importeCentimos), x: COL.importeX, width: COL.importeW, align: 'right' },
  ]
}

function seccion(
  w: W,
  titulo: string,
  lineas: LineaReciboPdf[],
  subtotalCentimos: number,
  labels: ReciboPdfLabels
): void {
  w.gap(6)
  w.text(titulo, { size: 12, bold: true })
  w.gap(2)
  // Cabecera de columnas.
  w.row(
    [
      { text: labels.concepto, x: COL.conceptoX, width: COL.conceptoW, color: MUTED },
      {
        text: labels.cantidad,
        x: COL.cantidadX,
        width: COL.cantidadW,
        align: 'right',
        color: MUTED,
      },
      {
        text: labels.precioUnitario,
        x: COL.precioX,
        width: COL.precioW,
        align: 'right',
        color: MUTED,
      },
      { text: labels.importe, x: COL.importeX, width: COL.importeW, align: 'right', color: MUTED },
    ],
    { size: 9 }
  )
  for (const l of lineas) w.row(filaLinea(l), { size: 10 })
  // Subtotal.
  w.row(
    [
      {
        text: labels.subtotal,
        x: COL.conceptoX,
        width: COL.conceptoW + COL.cantidadW + COL.precioW,
        color: MUTED,
      },
      {
        text: formatEuros(subtotalCentimos),
        x: COL.importeX,
        width: COL.importeW,
        align: 'right',
        bold: true,
      },
    ],
    { size: 10 }
  )
}

export async function generarReciboPdf(data: ReciboPdfData): Promise<Uint8Array> {
  const { doc, writer: w } = await nuevoDocumento()
  doc.setTitle(`${data.labels.documento} — ${data.titulo}`)

  // Logo de NIDO arriba.
  const logo = await embedLogoNido(doc)
  w.image(logo, { width: 120, align: 'left' })
  w.gap(6)

  // Cabecera.
  w.text(data.centroNombre, { size: 13, bold: true })
  w.gap(2)
  w.text(`${data.labels.documento} · ${data.titulo}`, { size: 18, bold: true })
  const meta = [data.estadoLabel, data.metodoLabel].filter(Boolean).join('   ·   ')
  if (meta) w.text(meta, { size: 11, color: MUTED })
  if (data.fechaLinea) w.text(data.fechaLinea, { size: 10, color: MUTED })
  w.gap(6)
  w.rule()

  // Una sección por hijo (nombre como cabecera, una sola vez).
  for (const g of data.gruposHijo) {
    seccion(w, g.ninoNombre, g.lineas, g.subtotalCentimos, data.labels)
  }
  if (data.lineasFamiliares.length > 0) {
    seccion(
      w,
      data.labels.lineasFamiliares,
      data.lineasFamiliares,
      data.subtotalFamiliarCentimos,
      data.labels
    )
  }

  // Total general.
  w.gap(6)
  w.rule()
  w.gap(2)
  w.row(
    [
      {
        text: data.labels.total,
        x: COL.conceptoX,
        width: COL.conceptoW + COL.cantidadW + COL.precioW,
        bold: true,
      },
      {
        text: formatEuros(data.totalCentimos),
        x: COL.importeX,
        width: COL.importeW,
        align: 'right',
        bold: true,
      },
    ],
    { size: 12 }
  )

  return w.bytes()
}
