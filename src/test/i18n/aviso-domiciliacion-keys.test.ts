import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

/**
 * Aviso a Dirección de la domiciliación firmada o cambiada por la familia: la clave que pinta
 * `AvisosInicio` existe en los tres idiomas y usa el contador `n` en plural.
 */
describe('i18n — aviso de domiciliación nueva', () => {
  it.each([
    ['es', es],
    ['en', en],
    ['va', va],
  ])('notificaciones.avisos.domiciliaciones_nuevas en %s', (_locale, msgs) => {
    const avisos = (msgs as { notificaciones: { avisos: Record<string, string> } }).notificaciones
      .avisos
    const texto = avisos.domiciliaciones_nuevas
    expect(texto).toMatch(/^\{n, plural, one \{.+\} other \{.*#.*\}\}$/)
  })
})
