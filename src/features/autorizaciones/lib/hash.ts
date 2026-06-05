import { createHash } from 'crypto'

/**
 * Normaliza el texto antes de hashear para que el hash sea **estable e
 * inequívoco**: normaliza saltos de línea (CRLF/CR → LF) y recorta espacios al
 * final. NO toca el contenido interno — el texto legal se hashea tal cual lo vio
 * el firmante (salvo el ruido de fin de línea que introducen distintos clientes).
 */
export function normalizarTexto(texto: string): string {
  return texto.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '')
}

/**
 * SHA-256 (hex de 64 chars) del texto exacto de una autorización. Se computa
 * **siempre server-side** al firmar y debe coincidir con el de la versión
 * vigente del documento — prueba de integridad de F8 (si el texto cambia, el
 * hash no cuadra). El CHECK de BD exige `^[0-9a-f]{64}$`.
 */
export function hashTextoAutorizacion(texto: string): string {
  return createHash('sha256').update(normalizarTexto(texto), 'utf8').digest('hex')
}
