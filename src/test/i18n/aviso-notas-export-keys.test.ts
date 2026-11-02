import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

/**
 * 2c (decisión del responsable del 2026-11-02): las notas de Dirección (la del prospecto de la lista
 * de espera y las del niño) salen en el export art. 15 de la familia, y la pantalla lo avisa. Si
 * falta una clave, next-intl pondría el path crudo donde tenía que ir el aviso.
 */
const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

function campos(msgs: Record<string, unknown>, seccion: string): Record<string, string> {
  const admin = msgs.admin as Record<string, Record<string, unknown>>
  return admin[seccion]!.fields as Record<string, string>
}

describe('i18n — el aviso de que la familia puede leer las notas', () => {
  for (const [locale, msgs] of LOCALES) {
    it(`${locale}: el del prospecto y el de la ficha del niño existen y no están vacíos`, () => {
      expect(campos(msgs, 'admisiones').nota_aviso?.trim().length ?? 0).toBeGreaterThan(0)
      expect(campos(msgs, 'ninos').notas_admin_aviso?.trim().length ?? 0).toBeGreaterThan(0)
    })

    it(`${locale}: la etiqueta de las notas dice quién las escribe, no que sean internas`, () => {
      const etiqueta = campos(msgs, 'ninos').notas_admin
      // Decisión del responsable del 2026-11-02: «Notas internas» prometía lo contrario del aviso.
      expect(etiqueta).not.toMatch(/intern|admin notes/i)
      // La misma en la ficha y en el documento que recibe la familia.
      const exp = (msgs.export as Record<string, Record<string, Record<string, string>>>).doc!
      expect(exp.campos!.notas_admin).toBe(etiqueta)
    })
  }
})
