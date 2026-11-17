import { describe, expect, it } from 'vitest'

import { VALORES_CONOCIDOS } from '@/features/export/lib/render-html'
import { CONSENT_VERSIONS } from '@/shared/lib/consent-versions'
import { Constants } from '@/types/db'

/**
 * Cada tipo de consentimiento sale en la exportación del art. 15 con su nombre en el idioma de quien
 * la pide (`export.doc.valores.*`). Un tipo que no está en `VALORES_CONOCIDOS` sale «humanizado» del
 * código, en castellano también en en y va. La lista de tipos se COPIA del enum de los tipos (que la
 * CI compara con la base: `comparar-tipos.mjs`), no se escribe a mano: así el tipo nuevo de la fase
 * 10 (`imagen_denegada`, `20270126120000`) y el siguiente no pueden olvidarse.
 */
describe('consentimiento_tipo: cada tipo tiene nombre en la exportación', () => {
  const tipos = [...Constants.public.Enums.consentimiento_tipo]

  it('premisa: el enum trae los cinco, con el «no» de la imagen', () => {
    expect(tipos).toEqual(['terminos', 'privacidad', 'imagen', 'datos_medicos', 'imagen_denegada'])
  })

  it.each(tipos)('%s está en VALORES_CONOCIDOS y tiene versión', (tipo) => {
    expect(VALORES_CONOCIDOS.has(tipo)).toBe(true)
    expect(CONSENT_VERSIONS[tipo]).toMatch(/^v\d+\.\d+$/)
  })
})
