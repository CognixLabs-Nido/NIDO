/**
 * Declaración mínima para `heic-decode` (sin `@types`). Solo el subconjunto que
 * usa el pipeline de F10-1: decodificar el HEIC/HEIF a píxeles RGBA crudos, que
 * se pasan directos a sharp (sin re-codificar a JPEG con jpeg-js).
 * Ver `src/features/fotos/lib/procesar-foto.ts`.
 */
declare module 'heic-decode' {
  interface DecodedImage {
    width: number
    height: number
    /** Píxeles RGBA crudos (4 canales). */
    data: ArrayBuffer
  }
  function decode(options: { buffer: Buffer | Uint8Array | ArrayBuffer }): Promise<DecodedImage>
  export = decode
}
