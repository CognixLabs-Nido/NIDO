import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { PDFDocument, PDFImage } from 'pdf-lib'

/**
 * Carga + embebe el logo de UN centro a partir de `centros.logo_url` (NO el de NIDO). En
 * Ola 1 ese valor puede ser (a) un path relativo servido desde `public/brand/...` (semilla,
 * p. ej. ANAIA `/brand/anaia-logo-wordmark.png`) o (b) una URL pública de Supabase Storage
 * (cuando dirección sube su logo). Se resuelven ambos: el path relativo se lee del
 * filesystem (runtime nodejs); la URL absoluta se descarga.
 *
 * Reutilizable: lo usa el PDF del recibo (B4) y lo reusará la vista interna (B3). Toca el
 * filesystem/red, por eso vive aparte del módulo puro `document.ts`.
 */

async function bytesLogoCentro(logoUrl: string): Promise<Uint8Array | null> {
  try {
    if (/^https?:\/\//i.test(logoUrl)) {
      const res = await fetch(logoUrl)
      if (!res.ok) return null
      return new Uint8Array(await res.arrayBuffer())
    }
    // Path relativo dentro de public/ (empieza por '/'); se quita el cache-bust (?v=...).
    const rel = (logoUrl.split('?')[0] ?? logoUrl).replace(/^\/+/, '')
    const ruta = path.join(process.cwd(), 'public', rel)
    return new Uint8Array(await readFile(ruta))
  } catch {
    return null
  }
}

/**
 * Devuelve el logo del centro embebido en `doc`, listo para `writer.image(...)`. Devuelve
 * `null` si el centro no tiene logo o si no se pudo cargar/decodificar → el llamante omite
 * el logo (no se inventa ni se cae a NIDO).
 */
export async function embedLogoCentro(
  doc: PDFDocument,
  logoUrl: string | null
): Promise<PDFImage | null> {
  if (!logoUrl) return null
  const bytes = await bytesLogoCentro(logoUrl)
  if (!bytes) return null
  try {
    return await doc.embedPng(bytes)
  } catch {
    try {
      return await doc.embedJpg(bytes)
    } catch {
      return null
    }
  }
}
