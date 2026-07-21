import { MUTED, nuevoDocumento } from '@/shared/lib/pdf/document'

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

/** Formatea un ISO a DD/MM/YYYY (castellano); '' si no hay fecha. */
function fechaEs(iso: string | null): string {
  if (!iso) return ''
  const ymd = iso.slice(0, 10)
  const [y, m, d] = ymd.split('-')
  return y && m && d ? `${d}/${m}/${y}` : ymd
}

/**
 * Genera el PDF de un informe publicado. Cabecera (centro · niño · período · curso ·
 * fecha de publicación), áreas → ítems con su valoración y comentarios,
 * observaciones generales, y al pie el redactor + fecha. Usa el SNAPSHOT del informe
 * (estructura + respuestas), no la plantilla viva. Devuelve los bytes del PDF.
 */
export async function generarInformePdf(data: InformePdfData): Promise<Uint8Array> {
  const { doc, writer: w } = await nuevoDocumento()
  doc.setTitle(`Informe de evolución — ${data.ninoNombre}`)

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
