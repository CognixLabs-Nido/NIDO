import { describe, expect, it } from 'vitest'

import { ImagenesAPdfError, MAX_PAGINAS_PDF, imagenesAPdf } from '../imagenes-a-pdf'

/**
 * Validaciones tempranas del pipeline imagen→PDF (las que ocurren ANTES de tocar canvas,
 * no disponible en el entorno de test). El render real se cubre en E2E/manual.
 */
describe('imagenesAPdf — validación de entrada', () => {
  it('rechaza una lista vacía', async () => {
    await expect(imagenesAPdf([])).rejects.toBeInstanceOf(ImagenesAPdfError)
    await expect(imagenesAPdf([])).rejects.toMatchObject({
      clave: 'alta.documentos.errors.sin_imagenes',
    })
  })

  it('rechaza más de MAX_PAGINAS_PDF imágenes', async () => {
    const muchas = Array.from(
      { length: MAX_PAGINAS_PDF + 1 },
      () => new File(['x'], 'p.png', { type: 'image/png' })
    )
    await expect(imagenesAPdf(muchas)).rejects.toMatchObject({
      clave: 'alta.documentos.errors.demasiadas_imagenes',
    })
  })
})
