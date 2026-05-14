#!/usr/bin/env node
/**
 * Procesa el logo source de NIDO y genera las variantes para la app.
 *
 * Reglas:
 *  - Idempotente: mismo source PNG + misma versión de sharp → mismo output PNG.
 *  - Manual: NO se ejecuta en build ni en CI. Los outputs van commiteados.
 *  - Threshold de luminancia para convertir el fondo negro en transparente.
 *
 * Comando:
 *   node scripts/process-logos.mjs
 *
 * Re-ejecutar cuando se actualice public/brand/source/nido-logo-source.png.
 */
import sharp from 'sharp'
import { mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const SOURCE = 'public/brand/source/nido-logo-source.png'
const OUT_DIR = 'public/brand'
const APP_DIR = 'src/app'
const TEMP_TRANSPARENT = join(tmpdir(), 'nido-logo-transparent.png')

const THRESHOLD_LOW = 14
const THRESHOLD_HIGH = 42

// El contenido visible vive aproximadamente entre rows 248-775 del source
// 1024×1024 (resto es padding negro). Ratios calibrados a partir de ahí.
const CROP_WORDMARK_BOTTOM = 0.66 // ~ row 676, excluye tagline
const CROP_MARK_TOP = 0 //   trim quita el padding superior
const CROP_MARK_BOTTOM = 0.49 // ~ row 502, justo antes de "NiDO"

const PNG_OPTS = Object.freeze({
  compressionLevel: 9,
  effort: 10,
  palette: false,
  adaptiveFiltering: false,
})

const TRIM_OPTS = Object.freeze({
  background: { r: 0, g: 0, b: 0, alpha: 0 },
  threshold: 5,
})

const TRANSPARENT_BG = Object.freeze({ r: 0, g: 0, b: 0, alpha: 0 })

async function buildTransparentSource() {
  const { data, info } = await sharp(SOURCE)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const out = Buffer.alloc(data.length)
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const a = data[i + 3]
    const maxC = Math.max(r, g, b)
    let alpha
    if (maxC <= THRESHOLD_LOW) {
      alpha = 0
    } else if (maxC >= THRESHOLD_HIGH) {
      alpha = a
    } else {
      alpha = Math.round(((maxC - THRESHOLD_LOW) / (THRESHOLD_HIGH - THRESHOLD_LOW)) * a)
    }
    out[i] = r
    out[i + 1] = g
    out[i + 2] = b
    out[i + 3] = alpha
  }

  await sharp(out, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png(PNG_OPTS)
    .toFile(TEMP_TRANSPARENT)

  return { width: info.width, height: info.height }
}

// sharp 0.34 falla con "extract_area: bad extract area" si se encadena
// .extract().trim() en una misma pipeline. Solución: hacer extract en un
// pipeline aparte y volcar a Buffer, luego abrir ese buffer en otro pipeline
// para aplicar trim/resize.
async function extractToBuffer({ left, top, width, height }) {
  return sharp(TEMP_TRANSPARENT).extract({ left, top, width, height }).png(PNG_OPTS).toBuffer()
}

async function writePng(pipeline, outputPath) {
  await pipeline.png(PNG_OPTS).toFile(outputPath)
  console.log(`  ✓ ${outputPath}`)
}

async function main() {
  console.log(`Reading ${SOURCE}…`)
  await mkdir(OUT_DIR, { recursive: true })
  await mkdir(APP_DIR, { recursive: true })

  const { width, height } = await buildTransparentSource()
  console.log(`  transparent source: ${width}×${height}`)
  console.log(`  threshold: low=${THRESHOLD_LOW} high=${THRESHOLD_HIGH}`)

  const wordmarkHeight = Math.round(height * CROP_WORDMARK_BOTTOM)
  const markTop = Math.round(height * CROP_MARK_TOP)
  const markBottom = Math.round(height * CROP_MARK_BOTTOM)
  const markHeight = markBottom - markTop

  // ─── Full (logo completo con tagline) ────────────────────────────────
  await writePng(sharp(TEMP_TRANSPARENT).trim(TRIM_OPTS), join(OUT_DIR, 'nido-logo-full.png'))

  // ─── Wordmark (sin tagline) ──────────────────────────────────────────
  const wordmarkBuf = await extractToBuffer({
    left: 0,
    top: 0,
    width,
    height: wordmarkHeight,
  })
  await writePng(sharp(wordmarkBuf).trim(TRIM_OPTS), join(OUT_DIR, 'nido-logo-wordmark.png'))

  // ─── Mark (solo chick+nest, cuadrado) ────────────────────────────────
  const markBuf = await extractToBuffer({
    left: 0,
    top: markTop,
    width,
    height: markHeight,
  })

  await writePng(
    sharp(markBuf).trim(TRIM_OPTS).resize(512, 512, { fit: 'contain', background: TRANSPARENT_BG }),
    join(OUT_DIR, 'nido-logo-mark.png')
  )

  // ─── Iconos PWA ──────────────────────────────────────────────────────
  for (const size of [192, 512]) {
    await writePng(
      sharp(Buffer.from(markBuf))
        .trim(TRIM_OPTS)
        .resize(size, size, { fit: 'contain', background: TRANSPARENT_BG }),
      join(OUT_DIR, `icon-${size}.png`)
    )
  }

  // ─── Favicon Next.js App Router ──────────────────────────────────────
  await writePng(
    sharp(Buffer.from(markBuf))
      .trim(TRIM_OPTS)
      .resize(32, 32, { fit: 'contain', background: TRANSPARENT_BG }),
    join(APP_DIR, 'icon.png')
  )

  await writePng(
    sharp(Buffer.from(markBuf))
      .trim(TRIM_OPTS)
      .resize(180, 180, { fit: 'contain', background: TRANSPARENT_BG }),
    join(APP_DIR, 'apple-icon.png')
  )

  await unlink(TEMP_TRANSPARENT).catch(() => {})
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
