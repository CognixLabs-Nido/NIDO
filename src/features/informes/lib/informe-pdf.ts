import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

import type { EstructuraInforme, PeriodoInforme, RespuestasInforme, ValoracionItem } from '../types'

/**
 * Generador del PDF de un informe de evolución (F9-4, Q11: server-side). Usa
 * **pdf-lib** (JS puro, sin headless Chrome ni dependencias nativas → encaja en el
 * runtime serverless de Vercel; ver ADR-0043). La fuente estándar Helvetica
 * (WinAnsi/Latin-1) cubre los acentos del castellano. El contenido del PDF va
 * **siempre en castellano** (Q10), independiente del idioma de la interfaz; por eso
 * las etiquetas (período, escala) se fijan aquí y no salen de i18n.
 *
 * Módulo puro (sin `server-only`): el route handler le pasa los datos ya
 * autorizados y los tests lo ejercitan sin BD.
 */

/** Datos ya resueltos y autorizados para pintar el PDF (view model). */
export interface InformePdfData {
  centroNombre: string
  ninoNombre: string
  periodo: PeriodoInforme
  cursoNombre: string | null
  /** ISO de publicación; null si por algún motivo no constara. */
  publicadoEn: string | null
  /** Nombre del redactor (resuelto server-side con service role, ver query). */
  autorNombre: string | null
  estructura: EstructuraInforme
  respuestas: RespuestasInforme
  observaciones: string | null
}

const PERIODO_LABEL: Record<PeriodoInforme, string> = {
  trimestre_1: '1.er trimestre',
  trimestre_2: '2.º trimestre',
  trimestre_3: '3.er trimestre',
  fin_curso: 'Fin de curso',
}

const VALORACION_LABEL: Record<ValoracionItem, string> = {
  conseguido: 'Conseguido',
  en_proceso: 'En proceso',
  no_iniciado: 'No iniciado',
}

// A4 en puntos PDF y márgenes.
const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 56
const CONTENT_W = PAGE_W - MARGIN * 2
const BOTTOM = MARGIN
const COLOR = rgb(0.12, 0.12, 0.14)
const MUTED = rgb(0.4, 0.4, 0.44)

/** Formatea un ISO a DD/MM/YYYY (castellano); '' si no hay fecha. */
function fechaEs(iso: string | null): string {
  if (!iso) return ''
  const ymd = iso.slice(0, 10)
  const [y, m, d] = ymd.split('-')
  return y && m && d ? `${d}/${m}/${y}` : ymd
}

/**
 * Reemplaza por '?' los caracteres que la fuente estándar (WinAnsi/Latin-1) no
 * puede codificar. El contenido es castellano (Q10) y WinAnsi lo cubre, pero el
 * texto libre que teclea un educador (comentarios, observaciones) podría traer un
 * carácter fuera de rango (emoji, alfabeto no latino); sin esto, `drawText`
 * lanzaría y la ruta devolvería 500. Robustez por encima de fidelidad exótica.
 */
function sanitize(text: string, font: PDFFont): string {
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
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
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

/** Cursor de escritura con paginación automática. */
class Writer {
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
      color?: typeof COLOR
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

  /** Línea separadora horizontal sutil. */
  rule(): void {
    this.ensure(8)
    this.page.drawLine({
      start: { x: MARGIN, y: this.y - 2 },
      end: { x: PAGE_W - MARGIN, y: this.y - 2 },
      thickness: 0.5,
      color: rgb(0.82, 0.82, 0.85),
    })
    this.y -= 8
  }

  bytes(): Promise<Uint8Array> {
    return this.doc.save()
  }
}

/**
 * Genera el PDF de un informe publicado. Cabecera (centro · niño · período · curso ·
 * fecha de publicación), áreas → ítems con su valoración y comentarios,
 * observaciones generales, y al pie el redactor + fecha. Usa el SNAPSHOT del informe
 * (estructura + respuestas), no la plantilla viva. Devuelve los bytes del PDF.
 */
export async function generarInformePdf(data: InformePdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`Informe de evolución — ${data.ninoNombre}`)
  doc.setCreator('NIDO')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const w = new Writer(doc, font, bold)

  // --- Cabecera ---
  w.text(data.centroNombre, { size: 13, bold: true })
  w.gap(2)
  w.text('Informe de evolución', { size: 18, bold: true })
  w.gap(6)
  w.text(data.ninoNombre, { size: 13, bold: true })
  const meta = [
    `Período: ${PERIODO_LABEL[data.periodo]}`,
    data.cursoNombre ? `Curso: ${data.cursoNombre}` : null,
  ]
    .filter(Boolean)
    .join('   ·   ')
  w.text(meta, { size: 11, color: MUTED })
  if (data.publicadoEn) {
    w.text(`Publicado el ${fechaEs(data.publicadoEn)}`, { size: 11, color: MUTED })
  }
  w.gap(6)
  w.rule()
  w.gap(6)

  // --- Áreas → ítems ---
  for (const area of data.estructura) {
    w.text(area.titulo, { size: 14, bold: true })
    w.gap(4)
    for (const item of area.items) {
      const r = data.respuestas[item.id]
      const valoracion = r?.valoracion ? VALORACION_LABEL[r.valoracion] : '—'
      w.text(item.texto, { size: 11, bold: true })
      w.text(`Valoración: ${valoracion}`, { size: 11, indent: 12, color: MUTED })
      if (r?.comentario) w.text(r.comentario, { size: 11, indent: 12 })
      w.gap(6)
    }
    w.gap(6)
  }

  // --- Observaciones generales ---
  w.text('Observaciones generales', { size: 14, bold: true })
  w.gap(4)
  w.text(data.observaciones && data.observaciones.trim().length > 0 ? data.observaciones : '—', {
    size: 11,
  })
  w.gap(14)

  // --- Pie: autor + fecha ---
  w.rule()
  w.gap(4)
  if (data.autorNombre) w.text(`Redactado por: ${data.autorNombre}`, { size: 10, color: MUTED })
  if (data.publicadoEn)
    w.text(`Fecha de publicación: ${fechaEs(data.publicadoEn)}`, { size: 10, color: MUTED })

  return w.bytes()
}
