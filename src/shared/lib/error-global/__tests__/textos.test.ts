import { describe, expect, it } from 'vitest'

import en from '../../../../../messages/en.json'
import es from '../../../../../messages/es.json'
import va from '../../../../../messages/va.json'
import { localeDeRuta, TEXTOS_ERROR_GLOBAL } from '../textos'

/** La página de error global copia dos textos de `messages/`: no pueden divergir. */
describe('textos de la página de error global', () => {
  it.each([
    ['es', es],
    ['en', en],
    ['va', va],
  ] as const)('%s: coinciden con common.error y common.retry', (locale, mensajes) => {
    expect(TEXTOS_ERROR_GLOBAL[locale]).toEqual({
      titulo: mensajes.common.error,
      reintentar: mensajes.common.retry,
    })
  })

  it('cubre exactamente los idiomas de la app', () => {
    expect(Object.keys(TEXTOS_ERROR_GLOBAL).sort()).toEqual(['en', 'es', 'va'])
  })

  it.each([
    ['/va/family', 'va'],
    ['/en', 'en'],
    ['/es/admin', 'es'],
    ['/fr/x', 'es'],
    ['/', 'es'],
    [null, 'es'],
  ] as const)('localeDeRuta(%s) = %s', (ruta, esperado) => {
    expect(localeDeRuta(ruta)).toBe(esperado)
  })
})
