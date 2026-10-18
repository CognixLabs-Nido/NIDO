import { describe, expect, it } from 'vitest'

import { rutaInterna } from '../ruta-interna'

describe('rutaInterna — un returnTo solo vale dentro de la app', () => {
  it.each([['/es/admin/recibos?mes=3'], ['/es/select-role'], ['/es/profile/invitations']])(
    '%s se respeta',
    (ruta) => {
      expect(rutaInterna('es', ruta)).toBe(ruta)
    }
  )

  it.each([
    ['vacío', undefined],
    ['null', null],
    ['cadena vacía', ''],
    ['URL absoluta', 'https://evil.test/es/admin'],
    ['protocol-relative', '//evil.test/es/admin'],
    ['javascript:', 'javascript:alert(1)'],
    ['otro idioma', '/en/admin'],
    ['sin barra final de idioma', '/esadmin'],
    ['barra invertida', '/es/\\evil.test'],
    ['carácter de control', '/es/admin\nSet-Cookie: x'],
  ])('%s → null', (_caso, ruta) => {
    expect(rutaInterna('es', ruta)).toBeNull()
  })

  // Con un idioma válido, el prefijo `/{locale}/` ya deja fuera `//host`; la comprobación
  // explícita es para un idioma vacío, donde el prefijo sería justo `//`.
  it('idioma vacío: `//host` no cuela por el prefijo', () => {
    expect(rutaInterna('', '//evil.test/x')).toBeNull()
  })
})
