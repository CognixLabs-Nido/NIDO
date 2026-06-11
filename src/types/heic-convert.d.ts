/**
 * Declaración mínima para `heic-convert` (sin `@types`). Solo el subconjunto
 * que usa el pipeline de F10-1: decodificar un buffer HEIC/HEIF a JPEG.
 * Ver `src/features/fotos/lib/procesar-foto.ts`.
 */
declare module 'heic-convert' {
  interface ConvertOptions {
    /** Buffer del HEIC/HEIF de entrada. */
    buffer: Buffer | Uint8Array | ArrayBuffer
    /** Formato de salida. */
    format: 'JPEG' | 'PNG'
    /** Calidad JPEG en [0, 1]. Ignorado para PNG. */
    quality?: number
  }
  function convert(options: ConvertOptions): Promise<ArrayBuffer>
  export = convert
}
