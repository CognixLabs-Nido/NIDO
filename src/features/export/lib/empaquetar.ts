import 'server-only'

import JSZip from 'jszip'

import { renderExportHtml } from './render-html'
import type { DocumentoExport } from '../types'

/**
 * Empaqueta el export en un ZIP con `datos.json` (canónico, máquina — art. 20) y
 * `datos.html` (copia legible — art. 15). Los binarios NO se empaquetan: van como
 * enlaces firmados dentro del JSON/HTML (#4).
 */
export async function empaquetarExport(doc: DocumentoExport): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('datos.json', JSON.stringify(doc, null, 2))
  zip.file('datos.html', renderExportHtml(doc))
  return zip.generateAsync({ type: 'uint8array' })
}
