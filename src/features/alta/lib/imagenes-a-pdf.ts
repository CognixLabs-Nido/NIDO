import { jsPDF } from 'jspdf'

/**
 * F11-G — pipeline CLIENTE multi-imagen → 1 PDF (decisiones B/C). Reutilizable para el
 * libro de familia (varias hojas) y los DNIs (2 caras). Cada imagen se re-encoda a JPEG
 * (downscale a `MAX_LADO_PX`, calidad `JPEG_QUALITY`) sobre un canvas para acotar el peso
 * por debajo del límite del bucket (10 MB), y se coloca centrada en una página A4 vertical
 * conservando proporción. El resultado es un `Blob application/pdf` listo para subir.
 *
 * Usa APIs de navegador (`Image`, `canvas`) → solo se importa desde componentes cliente.
 */

const MAX_LADO_PX = 1600
const JPEG_QUALITY = 0.82
/** Tope de páginas por documento (defensa: una subida no debería superar el bucket). */
export const MAX_PAGINAS_PDF = 8

export class ImagenesAPdfError extends Error {
  constructor(public readonly clave: string) {
    super(clave)
    this.name = 'ImagenesAPdfError'
  }
}

async function cargarImagen(file: File): Promise<HTMLImageElement> {
  if (!file.type.startsWith('image/')) {
    throw new ImagenesAPdfError('alta.documentos.errors.tipo_imagen')
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new ImagenesAPdfError('alta.documentos.errors.imagen_invalida'))
      img.src = url
    })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Re-encoda una imagen ya decodificada a JPEG (downscaled) y devuelve dataURL + tamaño. */
function aJpeg(img: HTMLImageElement): { dataUrl: string; w: number; h: number } {
  const origW = img.naturalWidth
  const origH = img.naturalHeight
  if (origW === 0 || origH === 0) {
    throw new ImagenesAPdfError('alta.documentos.errors.imagen_invalida')
  }
  const escala = Math.min(1, MAX_LADO_PX / Math.max(origW, origH))
  const w = Math.max(1, Math.round(origW * escala))
  const h = Math.max(1, Math.round(origH * escala))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ImagenesAPdfError('alta.documentos.errors.procesado')
  // Fondo blanco: PNGs con transparencia no quedan en negro al pasar a JPEG.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  return { dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY), w, h }
}

/**
 * Convierte una lista de imágenes en un único PDF (una imagen por página A4). Lanza
 * `ImagenesAPdfError` con clave i18n ante entrada vacía, exceso de páginas o imagen
 * ilegible.
 */
export async function imagenesAPdf(files: File[]): Promise<Blob> {
  if (files.length === 0) throw new ImagenesAPdfError('alta.documentos.errors.sin_imagenes')
  if (files.length > MAX_PAGINAS_PDF) {
    throw new ImagenesAPdfError('alta.documentos.errors.demasiadas_imagenes')
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margen = 24
  const maxW = pageW - margen * 2
  const maxH = pageH - margen * 2

  for (let i = 0; i < files.length; i++) {
    const img = await cargarImagen(files[i])
    const { dataUrl, w, h } = aJpeg(img)
    const escala = Math.min(maxW / w, maxH / h)
    const dibW = w * escala
    const dibH = h * escala
    const x = (pageW - dibW) / 2
    const y = (pageH - dibH) / 2
    if (i > 0) doc.addPage()
    doc.addImage(dataUrl, 'JPEG', x, y, dibW, dibH)
  }

  return doc.output('blob')
}
