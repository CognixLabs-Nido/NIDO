/**
 * Detección de HEIC/HEIF por la marca de la caja `ftyp` (ISO-BMFF), SIN decodificar.
 *
 * Helper puro (sin `server-only`) compartido por:
 *  - el **cliente** ([BlogAulaCliente]) para detectar un HEIC y convertirlo a JPEG en
 *    el navegador antes de subir (el decode HEIC ya NO corre en la función serverless:
 *    `@vercel/nft` no traza el `.wasm` de libheif → ENOENT al primer decode);
 *  - el **servidor** ([procesarFoto]) para rechazar con mensaje claro cualquier HEIC
 *    que, pese a todo, llegue sin convertir — así libheif nunca vuelve al runtime.
 *
 * Brands HEIC/HEIF: `heic`, `heix`, `heim`, `heis`, `mif1`, `msf1`, `hevc`, `hevx`.
 */
const BRANDS_HEIC = ['heic', 'heix', 'heim', 'heis', 'mif1', 'msf1', 'hevc', 'hevx']

/** `true` si los primeros bytes corresponden a un contenedor HEIC/HEIF. */
export function esHeicBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...Array.from(bytes.subarray(start, end)))
  if (ascii(4, 8) !== 'ftyp') return false
  return BRANDS_HEIC.includes(ascii(8, 12))
}
