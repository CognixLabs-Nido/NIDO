import 'server-only'

import JSZip from 'jszip'

import { renderExportHtml, type Etiquetador } from './render-html'
import type { DocumentoExport } from '../types'

/**
 * Empaqueta el export en un ZIP con `datos.json` (canónico, máquina — art. 20) y
 * `datos.html` (copia legible — art. 15). Los binarios NO se empaquetan: van como
 * enlaces firmados dentro del JSON/HTML (#4). `t` = traductor del namespace `export`.
 */
export async function empaquetarExport(doc: DocumentoExport, t: Etiquetador): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('datos.json', JSON.stringify(doc, null, 2))
  zip.file('datos.html', renderExportHtml(doc, t))
  return zip.generateAsync({ type: 'uint8array' })
}
