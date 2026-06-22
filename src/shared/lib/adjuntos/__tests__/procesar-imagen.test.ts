// @vitest-environment node
// Procesado server-side (sharp, binario nativo de libvips): entorno node, no jsdom.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { FotoInvalidaError } from '@/features/fotos/lib/procesar-foto'

import {
  MAX_BYTES_ADJUNTO,
  procesarDocumento,
  procesarFotoAvatar,
  procesarFotoNino,
  procesarLogo,
} from '../procesar-imagen'

/**
 * Tests del procesado de adjuntos de F10-3 (foto del niño, DNI, logo). Reusan el
 * criterio de F10-1: la salida NO conserva EXIF/geolocalización, rechaza HEIC con
 * mensaje claro y tipos/tamaños no permitidos. Cada adjunto tiene su perfil:
 * documento (legible, alta resolución), foto del niño (perfil + avatar JPEG), logo
 * (PNG con transparencia).
 */

/** Fixture HEIC real (single-image), reutilizado de F10-1 (sin PII). */
const SAMPLE_HEIC = readFileSync(
  join(__dirname, '../../../../features/fotos/lib/__tests__/fixtures/sample-bridge.heic')
)

async function jpegConExif(width = 1200, height = 800): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 160, b: 90 } },
  })
    .withExif({ IFD0: { Copyright: 'NIDO', Make: 'TestCam', Model: 'X1' } })
    .jpeg()
    .toBuffer()
}

/** PNG con canal alfa (transparencia parcial) para validar que el logo la conserva. */
async function pngConAlfa(width = 800, height = 300): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } },
  })
    .png()
    .toBuffer()
}

describe('procesarFotoNino (F10-3)', () => {
  it('quita EXIF y normaliza a JPEG con miniatura más pequeña', async () => {
    const entrada = await jpegConExif(1600, 1200)
    expect((await sharp(entrada).metadata()).exif).toBeInstanceOf(Buffer)

    const out = await procesarFotoNino(entrada)
    expect(out.mime).toBe('image/jpeg')
    const meta = await sharp(out.original).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.exif).toBeUndefined()
    expect(out.ancho).toBeLessThanOrEqual(1024)
    const mini = await sharp(out.miniatura).metadata()
    expect(mini.width ?? 0).toBeLessThanOrEqual(320)
    expect(out.miniatura.byteLength).toBeLessThan(out.original.byteLength)
  })

  it('rechaza HEIC con mensaje claro', async () => {
    await expect(procesarFotoNino(SAMPLE_HEIC)).rejects.toMatchObject({
      clave: 'fotos.validation.heic_no_soportado',
    })
  })
})

describe('procesarFotoAvatar (F11-C-3 — avatar de usuario)', () => {
  it('quita EXIF y normaliza a JPEG con miniatura ≤256', async () => {
    const entrada = await jpegConExif(1600, 1200)
    expect((await sharp(entrada).metadata()).exif).toBeInstanceOf(Buffer)

    const out = await procesarFotoAvatar(entrada)
    expect(out.mime).toBe('image/jpeg')
    const meta = await sharp(out.original).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.exif).toBeUndefined()
    expect(out.ancho).toBeLessThanOrEqual(1024)
    const mini = await sharp(out.miniatura).metadata()
    expect(mini.width ?? 0).toBeLessThanOrEqual(256)
  })

  it('rechaza HEIC con mensaje claro (ADR-0046)', async () => {
    await expect(procesarFotoAvatar(SAMPLE_HEIC)).rejects.toMatchObject({
      clave: 'fotos.validation.heic_no_soportado',
    })
  })

  it('rechaza un archivo que supera el tope de 4 MB', async () => {
    const grande = Buffer.alloc(MAX_BYTES_ADJUNTO + 1, 0)
    await expect(procesarFotoAvatar(grande)).rejects.toMatchObject({
      clave: 'fotos.validation.tamano_max',
    })
  })
})

describe('procesarDocumento (F10-3 — DNI legible)', () => {
  it('quita EXIF, normaliza a JPEG y conserva alta resolución (≤2200)', async () => {
    const entrada = await jpegConExif(3000, 2000)
    const out = await procesarDocumento(entrada)
    expect(out.mime).toBe('image/jpeg')
    const meta = await sharp(out.original).metadata()
    expect(meta.exif).toBeUndefined()
    expect(out.ancho).toBeLessThanOrEqual(2200)
    // Documento: mantiene más resolución que una foto de blog (1600) — legibilidad.
    expect(out.ancho).toBeGreaterThan(1600)
  })

  it('genera miniatura para el listado', async () => {
    const out = await procesarDocumento(await jpegConExif(2000, 1400))
    const mini = await sharp(out.miniatura).metadata()
    expect(mini.width ?? 0).toBeLessThanOrEqual(480)
  })

  it('rechaza un binario que no es imagen', async () => {
    await expect(procesarDocumento(Buffer.from('no es imagen'))).rejects.toMatchObject({
      clave: 'fotos.validation.tipo_no_permitido',
    })
  })

  it('rechaza un archivo que supera el tamaño máximo', async () => {
    const grande = Buffer.alloc(MAX_BYTES_ADJUNTO + 1, 0)
    await expect(procesarDocumento(grande)).rejects.toBeInstanceOf(FotoInvalidaError)
    await expect(procesarDocumento(grande)).rejects.toMatchObject({
      clave: 'fotos.validation.tamano_max',
    })
  })

  it('rechaza HEIC con mensaje claro', async () => {
    await expect(procesarDocumento(SAMPLE_HEIC)).rejects.toMatchObject({
      clave: 'fotos.validation.heic_no_soportado',
    })
  })
})

describe('procesarLogo (F10-3 — PNG con transparencia)', () => {
  it('sale como PNG conservando el canal alfa, sin EXIF y reescalado (≤480)', async () => {
    const out = await procesarLogo(await pngConAlfa(800, 300))
    expect(out.mime).toBe('image/png')
    const meta = await sharp(out.original).metadata()
    expect(meta.format).toBe('png')
    expect(meta.hasAlpha).toBe(true)
    expect(meta.exif).toBeUndefined()
    expect(out.ancho).toBeLessThanOrEqual(480)
  })

  it('acepta también un JPEG de entrada', async () => {
    const out = await procesarLogo(await jpegConExif(600, 200))
    expect(out.mime).toBe('image/png')
    expect((await sharp(out.original).metadata()).format).toBe('png')
  })

  it('rechaza HEIC con mensaje claro', async () => {
    await expect(procesarLogo(SAMPLE_HEIC)).rejects.toMatchObject({
      clave: 'fotos.validation.heic_no_soportado',
    })
  })
})
