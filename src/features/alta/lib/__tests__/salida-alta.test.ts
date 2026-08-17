import { describe, expect, it } from 'vitest'

import { resolverSalidaAlta } from '../salida-alta'

/**
 * BUG 3 — la pantalla "¡Alta completada!" no tenía salida: solo "Revisar o editar", que
 * reentra al mismo wizard. Aquí se congela a dónde vuelve cada rol, porque el destino
 * depende de por dónde ENTRÓ y eso no se ve leyendo la pantalla.
 */
describe('resolverSalidaAlta', () => {
  it('dirección vuelve a admisiones (de donde abrió el wizard)', () => {
    expect(resolverSalidaAlta(true, 'es')).toEqual({
      href: '/es/admin/admisiones',
      claveEtiqueta: 'volver_admisiones',
    })
  })

  it('tutor vuelve a su panel de familia', () => {
    expect(resolverSalidaAlta(false, 'es')).toEqual({
      href: '/es/family',
      claveEtiqueta: 'volver_familia',
    })
  })

  it('respeta el locale en ambos destinos', () => {
    expect(resolverSalidaAlta(true, 'va').href).toBe('/va/admin/admisiones')
    expect(resolverSalidaAlta(false, 'en').href).toBe('/en/family')
  })

  it('nunca manda al tutor a admisiones (no es suya)', () => {
    expect(resolverSalidaAlta(false, 'es').href).not.toContain('admin')
  })
})
