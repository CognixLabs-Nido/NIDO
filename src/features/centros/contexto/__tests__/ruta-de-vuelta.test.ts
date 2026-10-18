import { describe, expect, it } from 'vitest'

import { rutaDeVuelta } from '../ruta-de-vuelta'

describe('rutaDeVuelta — returnTo solo vale dentro de la app', () => {
  it('una ruta interna del mismo idioma se respeta', () => {
    expect(rutaDeVuelta('es', '/es/admin/recibos?mes=3')).toBe('/es/admin/recibos?mes=3')
  })

  it.each([
    ['vacío', undefined],
    ['null', null],
    ['URL absoluta', 'https://evil.test/es/admin'],
    ['protocol-relative', '//evil.test/es/admin'],
    ['otro idioma', '/en/admin'],
    ['sin barra final de idioma', '/esadmin'],
    ['barra invertida', '/es/\\evil.test'],
    ['carácter de control', '/es/admin\nSet-Cookie: x'],
    ['el propio selector (bucle)', '/es/elegir-centro?returnTo=/es/admin'],
  ])('%s → reparto por rol', (_caso, returnTo) => {
    expect(rutaDeVuelta('es', returnTo)).toBe('/es/select-role')
  })
})
