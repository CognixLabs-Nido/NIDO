import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { PDFDocument, PDFImage } from 'pdf-lib'

/**
 * Embebe el logo de NIDO (wordmark) en un PDF. El asset es estático y vive en
 * `public/brand/nido-logo-wordmark.png` (el mismo que usa la web vía `LogoWordmark`);
 * se lee del filesystem del servidor (runtime nodejs) y se cachea entre invocaciones.
 *
 * Reutilizable: lo usa el PDF del recibo (B4) y lo reusará la vista interna (B3). Toca el
 * filesystem, por eso vive aparte del módulo puro `document.ts`.
 */

let cacheBytes: Uint8Array | null = null

async function bytesLogoNido(): Promise<Uint8Array> {
  if (!cacheBytes) {
    const ruta = path.join(process.cwd(), 'public', 'brand', 'nido-logo-wordmark.png')
    cacheBytes = new Uint8Array(await readFile(ruta))
  }
  return cacheBytes
}

/** Devuelve el logo de NIDO embebido en `doc`, listo para `writer.image(...)`. */
export async function embedLogoNido(doc: PDFDocument): Promise<PDFImage> {
  return doc.embedPng(await bytesLogoNido())
}
