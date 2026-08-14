import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

/**
 * Recibos · R-3 — salvaguarda i18n de la edición manual de líneas.
 *
 * Las claves nuevas las pinta el diálogo del panel del mes; si falta una en un idioma,
 * next-intl renderiza el path crudo. Además se fija que `editar_aviso` ya NO diga que las
 * ediciones se pierden al regenerar: eso era cierto antes de R-2 y ahora es justo lo
 * contrario — lo escrito a mano queda marcado y el motor lo respeta. Un aviso que miente
 * sobre si el trabajo se va a perder es peor que no tener aviso.
 */
const CLAVES = ['anadir_linea_title', 'anadir_linea_aviso', 'linea_manual', 'editar_aviso'] as const

const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

/** Lo que el aviso viejo prometía, y que R-2 volvió falso. */
const PROMESAS_CADUCADAS = [/se pierde/i, /are lost/i, /es perd/i]

function panel(msgs: Record<string, unknown>): Record<string, unknown> {
  return msgs.recibos_panel as Record<string, unknown>
}

describe('i18n consistency — edición manual de líneas (R-3)', () => {
  for (const [locale, msgs] of LOCALES) {
    describe(`locale=${locale}`, () => {
      it.each(CLAVES)('recibos_panel.%s existe y no está vacío', (key) => {
        const valor = panel(msgs)[key] as string | undefined
        expect(valor).toBeDefined()
        expect(valor!.trim().length).toBeGreaterThan(0)
      })

      it('recibos_panel.errors.recibo_ya_existe existe (colisión al crear al vuelo)', () => {
        const errores = panel(msgs).errors as Record<string, string>
        expect(errores.recibo_ya_existe).toBeDefined()
      })

      it('editar_aviso ya no promete que las ediciones se pierden al regenerar', () => {
        const aviso = panel(msgs).editar_aviso as string
        for (const patron of PROMESAS_CADUCADAS) {
          expect(aviso, `"${aviso}" sigue avisando de una pérdida que R-2 eliminó`).not.toMatch(
            patron
          )
        }
      })
    })
  }
})
