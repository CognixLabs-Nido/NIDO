import { describe, expect, it } from 'vitest'

import { FirmaNoDecodifica, generarMandatoPdf, type DatosMandatoPdf } from '../mandato-pdf'
import { PLANTILLA_PDF_MANDATO_VIGENTE } from '../mandato-pdf-plantillas'

/**
 * El trazo que no se puede pintar (2026-11-23): un PNG con la cabecera y sin imagen dentro pasa la
 * comprobación de la ruta y jspdf lanza `RangeError` al pintarlo. `generarMandatoPdf` lo convierte en
 * `FirmaNoDecodifica`, que las rutas dicen como «dibuja tu firma»; y SOLO eso: un fallo de otra parte
 * del PDF no puede salir como un problema de la firma.
 */
const VALIDO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const TRUNCADO = 'data:image/png;base64,iVBORw0KGgo='

const datos = (cambios: Partial<DatosMandatoPdf> = {}): DatosMandatoPdf => ({
  identificadorMandato: 'NIDO-PDF-FIRMA-1',
  iban: 'ES7620770024003102575766',
  titular: 'Tutor Demo',
  titularDocumento: 'X1234567L',
  titularDireccion: 'Calle Demo 1, Valencia',
  acreedorNombre: 'Centro Demo',
  acreedorCid: 'ES81ZZZB00000000',
  acreedorDireccion: 'Calle del Centro 2, Valencia',
  firmaDataUrl: VALIDO,
  fechaFirmaIso: '2026-11-23T10:00:00.000Z',
  idioma: 'es',
  plantillaVersion: PLANTILLA_PDF_MANDATO_VIGENTE,
  ...cambios,
})

function lanza(f: () => unknown): unknown {
  try {
    f()
  } catch (e) {
    return e
  }
  return null
}

describe('generarMandatoPdf y el trazo que no se puede pintar', () => {
  it('control: con un PNG válido compone el PDF', () => {
    const pdf = generarMandatoPdf(datos())
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-')
  })

  it('el PNG truncado: FirmaNoDecodifica, con el RangeError de jspdf como causa', () => {
    expect(TRUNCADO.startsWith('data:image/png'), 'premisa: pasa la comprobación de la ruta').toBe(
      true
    )
    const e = lanza(() => generarMandatoPdf(datos({ firmaDataUrl: TRUNCADO })))
    expect(e).toBeInstanceOf(FirmaNoDecodifica)
    expect((e as Error).cause).toBeInstanceOf(RangeError)
  })

  it('un fallo de otra parte del PDF no sale como un problema de la firma', () => {
    // Plantilla desconocida Y trazo truncado: lo que falla primero es la plantilla, y se dice eso.
    const e = lanza(() =>
      generarMandatoPdf(datos({ firmaDataUrl: TRUNCADO, plantillaVersion: 999 }))
    )
    expect(e, 'premisa: lanza').toBeInstanceOf(Error)
    expect(e).not.toBeInstanceOf(FirmaNoDecodifica)
    expect((e as Error).message).toMatch(/plantilla del mandato desconocida/)
  })
})
