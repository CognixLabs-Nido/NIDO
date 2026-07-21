import { rgb, StandardFonts, PDFDocument, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'

/**
 * Cimientos compartidos para generar PDFs server-side con **pdf-lib** (JS puro, sin
 * headless Chrome → runtime serverless de Vercel; ver ADR-0043). Extraído del generador
 * de informes (F9-4) para reutilizarlo desde recibos y otros documentos. El contenido va
 * en el idioma que le pase el llamante (los generadores resuelven sus etiquetas).
 *
 * Módulo puro (sin `server-only`): los route handlers le pasan datos ya autorizados y los
 * tests lo ejercitan sin BD. El logo (que sí toca el filesystem/red) vive en `logo-centro.ts`.
 */

export type PdfColor = ReturnType<typeof rgb>

// A4 en puntos PDF y márgenes.
export const PAGE_W = 595.28
export const PAGE_H = 841.89
export const MARGIN = 56
export const CONTENT_W = PAGE_W - MARGIN * 2
const BOTTOM = MARGIN
export const COLOR: PdfColor = rgb(0.12, 0.12, 0.14)
export const MUTED: PdfColor = rgb(0.4, 0.4, 0.44)
const RULE_COLOR = rgb(0.82, 0.82, 0.85)

/**
 * Reemplaza por '?' los caracteres que la fuente estándar (WinAnsi/Latin-1) no puede
 * codificar. El texto libre (nombres, comentarios) podría traer un carácter fuera de rango
 * (emoji, alfabeto no latino); sin esto `drawText` lanzaría y la ruta devolvería 500.
 */
export function sanitize(text: string, font: PDFFont): string {
  let out = ''
  for (const ch of text) {
    if (ch === '\n') {
      out += ch
      continue
    }
    try {
      font.widthOfTextAtSize(ch, 12) // encodeText interno lanza si no es codificable
      out += ch
    } catch {
      out += '?'
    }
  }
  return out
}

/** Parte un texto en líneas que caben en `maxWidth` para la fuente/tamaño dados. */
export function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = []
  for (const rawLine of text.split('\n')) {
    const words = rawLine.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      out.push('')
      continue
    }
    let line = ''
    for (const word of words) {
      const tentativa = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(tentativa, size) <= maxWidth) {
        line = tentativa
      } else {
        if (line) out.push(line)
        // Palabra sola más ancha que la caja: se parte por caracteres.
        if (font.widthOfTextAtSize(word, size) > maxWidth) {
          let chunk = ''
          for (const ch of word) {
            if (font.widthOfTextAtSize(chunk + ch, size) <= maxWidth) chunk += ch
            else {
              if (chunk) out.push(chunk)
              chunk = ch
            }
          }
          line = chunk
        } else {
          line = word
        }
      }
    }
    if (line) out.push(line)
  }
  return out
}

/** Una celda de una fila tabular (posición y ancho absolutos dentro del contenido). */
export interface RowCell {
  text: string
  /** x absoluto (pt) del inicio de la columna. */
  x: number
  /** ancho (pt) de la columna, para alinear a la derecha. */
  width: number
  align?: 'left' | 'right'
  bold?: boolean
  color?: PdfColor
}

/** Cursor de escritura con paginación automática. */
export class Writer {
  private page: PDFPage
  private y: number
  constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
    private readonly bold: PDFFont
  ) {
    this.page = doc.addPage([PAGE_W, PAGE_H])
    this.y = PAGE_H - MARGIN
  }

  private ensure(space: number): void {
    if (this.y - space < BOTTOM) {
      this.page = this.doc.addPage([PAGE_W, PAGE_H])
      this.y = PAGE_H - MARGIN
    }
  }

  gap(h: number): void {
    this.y -= h
  }

  /** Escribe un bloque de texto (con wrap) y avanza el cursor. */
  text(
    content: string,
    opts: {
      size?: number
      bold?: boolean
      color?: PdfColor
      indent?: number
      lineGap?: number
    } = {}
  ): void {
    const size = opts.size ?? 11
    const f = opts.bold ? this.bold : this.font
    const indent = opts.indent ?? 0
    const lineGap = opts.lineGap ?? 4
    const lineH = size + lineGap
    const lines = wrap(sanitize(content, f), f, size, CONTENT_W - indent)
    for (const line of lines) {
      this.ensure(lineH)
      this.page.drawText(line, {
        x: MARGIN + indent,
        y: this.y - size,
        size,
        font: f,
        color: opts.color ?? COLOR,
      })
      this.y -= lineH
    }
  }

  /** Dibuja una fila de celdas en columnas de posición fija y avanza una línea. */
  row(cells: RowCell[], opts: { size?: number; lineGap?: number } = {}): void {
    const size = opts.size ?? 11
    const lineGap = opts.lineGap ?? 5
    const lineH = size + lineGap
    this.ensure(lineH)
    for (const c of cells) {
      const f = c.bold ? this.bold : this.font
      const s = sanitize(c.text, f)
      const textW = f.widthOfTextAtSize(s, size)
      const x = c.align === 'right' ? c.x + c.width - textW : c.x
      this.page.drawText(s, { x, y: this.y - size, size, font: f, color: c.color ?? COLOR })
    }
    this.y -= lineH
  }

  /** Inserta una imagen escalada a `width` (alto proporcional) y avanza el cursor. */
  image(img: PDFImage, opts: { width: number; align?: 'left' | 'center' } = { width: 120 }): void {
    const width = opts.width
    const height = (img.height / img.width) * width
    this.ensure(height + 4)
    const x = opts.align === 'center' ? MARGIN + (CONTENT_W - width) / 2 : MARGIN
    this.page.drawImage(img, { x, y: this.y - height, width, height })
    this.y -= height + 4
  }

  /** Línea separadora horizontal sutil. */
  rule(): void {
    this.ensure(8)
    this.page.drawLine({
      start: { x: MARGIN, y: this.y - 2 },
      end: { x: PAGE_W - MARGIN, y: this.y - 2 },
      thickness: 0.5,
      color: RULE_COLOR,
    })
    this.y -= 8
  }

  bytes(): Promise<Uint8Array> {
    return this.doc.save()
  }
}

/** Crea un documento con las fuentes estándar embebidas y un `Writer` listo para escribir. */
export async function nuevoDocumento(): Promise<{ doc: PDFDocument; writer: Writer }> {
  const doc = await PDFDocument.create()
  doc.setCreator('NIDO')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  return { doc, writer: new Writer(doc, font, bold) }
}
