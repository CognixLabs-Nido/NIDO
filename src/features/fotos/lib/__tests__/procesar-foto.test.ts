import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { MAX_BYTES_FOTO } from '../../types'
import { FotoInvalidaError, procesarFoto } from '../procesar-foto'

/**
 * Tests del pipeline de procesado (F10-1, spec §Privacidad / §Tests requeridos):
 * la salida NO conserva EXIF/geolocalización, genera miniatura, normaliza a WebP
 * y rechaza tipos/tamaños no permitidos. La conversión HEIC→JPG se cubre por
 * enrutado (sin fixture HEIC: libheif no codifica, así que probamos detección +
 * manejo de error). El gate de etiquetado se cubre en la suite RLS de F10-0.
 */

/** JPEG de prueba con EXIF (incl. grupo GPS) embebido. */
async function jpegConExif(width = 1200, height = 800): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 160, b: 90 } },
  })
    .withExif({
      IFD0: { Copyright: 'NIDO', Make: 'TestCam', Model: 'X1' },
      GPS: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' },
    })
    .jpeg()
    .toBuffer()
}

describe('procesarFoto (F10-1)', () => {
  it('quita EXIF/geolocalización y normaliza a WebP', async () => {
    const entrada = await jpegConExif()
    // Sanity: la entrada SÍ trae EXIF.
    expect((await sharp(entrada).metadata()).exif).toBeInstanceOf(Buffer)

    const out = await procesarFoto(entrada)
    expect(out.mime).toBe('image/webp')

    const meta = await sharp(out.original).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.exif).toBeUndefined() // sin EXIF ni GPS
  })

  it('genera una miniatura más pequeña que el original', async () => {
    const out = await procesarFoto(await jpegConExif(1600, 1200))
    const orig = await sharp(out.original).metadata()
    const mini = await sharp(out.miniatura).metadata()
    expect(mini.format).toBe('webp')
    expect(mini.width ?? 0).toBeLessThanOrEqual(480)
    expect(mini.width ?? 0).toBeLessThan(orig.width ?? 0)
    expect(out.miniatura.byteLength).toBeLessThan(out.original.byteLength)
  })

  it('limita el lado mayor del original a 1600 px', async () => {
    const out = await procesarFoto(await jpegConExif(3000, 2000))
    expect(out.ancho).toBeLessThanOrEqual(1600)
    expect(out.alto).toBeLessThanOrEqual(1600)
  })

  it('procesa PNG además de JPEG', async () => {
    const png = await sharp({
      create: {
        width: 600,
        height: 400,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 1 },
      },
    })
      .png()
      .toBuffer()
    const out = await procesarFoto(png)
    expect(out.mime).toBe('image/webp')
    expect(out.ancho).toBe(600)
  })

  it('es idempotente por hash (mismo input → mismo hash)', async () => {
    const entrada = await jpegConExif(800, 600)
    const a = await procesarFoto(entrada)
    const b = await procesarFoto(entrada)
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(a.hash).toBe(b.hash)
  })

  it('rechaza un binario que no es imagen', async () => {
    await expect(procesarFoto(Buffer.from('esto no es una imagen'))).rejects.toMatchObject({
      clave: 'fotos.validation.tipo_no_permitido',
    })
  })

  it('rechaza un archivo que supera el tamaño máximo', async () => {
    const grande = Buffer.alloc(MAX_BYTES_FOTO + 1, 0)
    await expect(procesarFoto(grande)).rejects.toBeInstanceOf(FotoInvalidaError)
    await expect(procesarFoto(grande)).rejects.toMatchObject({
      clave: 'fotos.validation.tamano_max',
    })
  })

  it('enruta HEIC al decodificador y reporta error si la conversión falla', async () => {
    // Cabecera ISO-BMFF con marca `ftypheic` pero contenido inválido → heic-convert falla.
    const fakeHeic = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from('ftypheic'),
      Buffer.alloc(16, 0),
    ])
    await expect(procesarFoto(fakeHeic)).rejects.toMatchObject({
      clave: 'fotos.errors.heic_fallo',
    })
  })
})
