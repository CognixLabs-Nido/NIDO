import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { esHeicBytes } from '../es-heic'

/**
 * Detección de HEIC por la marca `ftyp` (helper compartido cliente/servidor, F10-1).
 * Es lo que dispara la conversión HEIC→JPEG en el navegador y el rechazo en servidor.
 */

/** Primeros bytes de un HEIC real (fixture sin PII). */
const HEIC_HEAD = readFileSync(join(__dirname, 'fixtures', 'sample-bridge.heic')).subarray(0, 32)

/** Caja `ftyp` sintética con el brand indicado. */
function ftyp(brand: string): Uint8Array {
  const buf = new Uint8Array(12)
  buf.set([0x00, 0x00, 0x00, 0x18], 0)
  buf.set(
    [...'ftyp'].map((c) => c.charCodeAt(0)),
    4
  )
  buf.set(
    [...brand].map((c) => c.charCodeAt(0)),
    8
  )
  return buf
}

describe('esHeicBytes', () => {
  it('detecta un HEIC real por su marca ftyp', () => {
    expect(esHeicBytes(HEIC_HEAD)).toBe(true)
  })

  it('detecta los brands HEIC/HEIF conocidos', () => {
    for (const brand of ['heic', 'heix', 'mif1', 'msf1', 'hevc']) {
      expect(esHeicBytes(ftyp(brand))).toBe(true)
    }
  })

  it('NO marca como HEIC un JPEG, un PNG ni una caja ftyp de otro tipo', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 0])
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    expect(esHeicBytes(jpeg)).toBe(false)
    expect(esHeicBytes(png)).toBe(false)
    expect(esHeicBytes(ftyp('mp42'))).toBe(false) // vídeo MP4, no HEIC
  })

  it('NO marca como HEIC un buffer demasiado corto', () => {
    expect(esHeicBytes(new Uint8Array([0x00, 0x00, 0x00]))).toBe(false)
    expect(esHeicBytes(new Uint8Array(0))).toBe(false)
  })
})
