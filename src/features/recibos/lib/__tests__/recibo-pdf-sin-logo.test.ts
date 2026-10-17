// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { generarReciboPdf, type ReciboPdfData } from '../recibo-pdf'

/**
 * Multicentro · Fase A: un centro sin logo (CEI Ejemplo, `logo_url = NULL`) tiene que dar un
 * recibo válido, sin logo y sin caerse. También el caso de la ventana de despliegue: el
 * `logo_url` todavía apunta al PNG de ANAIA, que ya no existe en `public/`.
 */

const BASE: ReciboPdfData = {
  centroNombre: 'CEI Ejemplo',
  logoUrl: null,
  titulo: 'Enero 2026',
  estadoLabel: 'Pendiente',
  metodoLabel: 'Domiciliación',
  fechaLinea: null,
  labels: {
    documento: 'Recibo',
    concepto: 'Concepto',
    cantidad: 'Cantidad',
    precioUnitario: 'Precio',
    importe: 'Importe',
    subtotal: 'Subtotal',
    total: 'Total',
    lineasFamiliares: 'Familia',
  },
  gruposHijo: [
    {
      ninoNombre: 'Niño Demo 1',
      lineas: [
        { etiqueta: 'Cuota', cantidad: 1, precioUnitarioCentimos: 30000, importeCentimos: 30000 },
      ],
      subtotalCentimos: 30000,
    },
  ],
  lineasFamiliares: [],
  subtotalFamiliarCentimos: 0,
  totalCentimos: 30000,
  locale: 'es',
}

const IMAGEN = '/Subtype /Image'

function texto(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('latin1')
}

describe('PDF del recibo con un centro sin logo', () => {
  it('control: con un logo que existe, el PDF lleva la imagen embebida', async () => {
    const pdf = await generarReciboPdf({ ...BASE, logoUrl: '/brand/nido-logo-wordmark.png' })
    expect(texto(pdf).startsWith('%PDF-')).toBe(true)
    expect(texto(pdf)).toContain(IMAGEN)
  })

  it('logo_url NULL: PDF válido, sin imagen', async () => {
    const pdf = await generarReciboPdf(BASE)
    expect(texto(pdf).startsWith('%PDF-')).toBe(true)
    expect(texto(pdf)).not.toContain(IMAGEN)
  })

  it('logo_url apuntando al PNG borrado de ANAIA: PDF válido, sin imagen', async () => {
    const pdf = await generarReciboPdf({ ...BASE, logoUrl: '/brand/anaia-logo-wordmark.png' })
    expect(texto(pdf).startsWith('%PDF-')).toBe(true)
    expect(texto(pdf)).not.toContain(IMAGEN)
  })
})
